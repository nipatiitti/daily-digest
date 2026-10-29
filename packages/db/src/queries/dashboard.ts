import {
  and,
  asc,
  type Column,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  min,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { type Db, runBatch } from "../client.ts"
import {
  actions,
  articles,
  coerce,
  columnOf,
  dbStats,
  deliveries,
  entities,
  facts,
  feedback,
  follows,
  gateLog,
  llmCalls,
  matchLog,
  type RollupKind,
  rollups,
  rowId,
  rowWhere,
  signals,
  sources,
  stories,
  storyEntities,
  storyThemes,
  storyVulns,
  TABLES,
  type TableMeta,
  type ThemeStatus,
  themeEvents,
  themes,
  vulns,
} from "../schema/index.ts"
import { spendSince } from "./ops.ts"
import { storyArticles } from "./stories.ts"
import { themeMomentum } from "./themes.ts"

/** The three header lamps: newest fetched item, stories waiting for a score, Claude spend since UTC midnight. */
export const lampInputs = async (db: Db, now: number) => {
  const [[newest], [backlog], spendTodayUsd] = await Promise.all([
    db.select({ at: sql<number | null>`max(${sources.lastNewItemAt})` }).from(sources),
    db
      .select({ n: sql<number>`count(*)` })
      .from(stories)
      .where(and(eq(stories.status, "active"), isNotNull(stories.extractionHash), isNull(stories.score))),
    spendSince(db, now - (now % 86_400_000)),
  ])
  return {
    minutesSinceNewItem: newest?.at == null ? null : Math.floor((now - newest.at) / 60_000),
    evalBacklog: backlog?.n ?? 0,
    spendTodayUsd,
  }
}

/** Index of `at` when [from, to) is cut into `slices` equal parts; cast so a real-bound parameter still floors. */
const sliceOf = (at: Column, from: number, to: number, slices: number) =>
  sql<number>`cast((${at} - ${from}) * ${slices} / ${to - from} as integer)`

/** The oldest desk bucket, where an "all" range starts; null before the first rollup. */
export const firstDeskBucket = async (db: Db) => {
  const [row] = await db
    .select({ bucket: sql<number | null>`min(${rollups.bucket})` })
    .from(rollups)
    .where(and(eq(rollups.kind, "desk"), eq(rollups.key, "desk")))
  return row?.bucket ?? null
}

/** Desk articles and new stories per slice of [from, to); empty slices are missing. */
export const deskSlices = (db: Db, from: number, to: number, slices: number) => {
  const slice = sliceOf(rollups.bucket, from, to, slices)
  return db
    .select({
      slice,
      articles: sql<number>`sum(${rollups.articles})`,
      newStories: sql<number>`sum(${rollups.newStories})`,
    })
    .from(rollups)
    .where(and(eq(rollups.kind, "desk"), eq(rollups.key, "desk"), gte(rollups.bucket, from), lt(rollups.bucket, to)))
    .groupBy(slice)
}

/** Extraction calls (story evaluations) per slice of [from, to); empty slices are missing. */
export const evaluationSlices = (db: Db, from: number, to: number, slices: number) => {
  const slice = sliceOf(llmCalls.at, from, to, slices)
  return db
    .select({ slice, n: sql<number>`count(*)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.purpose, "extraction"), gte(llmCalls.at, from), lt(llmCalls.at, to)))
    .groupBy(slice)
}

/** Active stories, and how many of them were first seen after `since`. */
export const activeStoryTotals = async (db: Db, since: number) => {
  const [row] = await db
    .select({ active: sql<number>`count(*)`, newSince: sql<number>`coalesce(sum(${stories.firstSeen} > ${since}), 0)` })
    .from(stories)
    .where(eq(stories.status, "active"))
  return { active: row?.active ?? 0, newSince: row?.newSince ?? 0 }
}

/** Articles per key and `bucketMs` bucket (an hour or a day) for `kind` in [from, to). */
export const rollupTotals = (db: Db, kind: RollupKind, keys: string[], from: number, to: number, bucketMs: number) => {
  const bucket = sql<number>`cast(${rollups.bucket} / ${bucketMs} as integer) * ${bucketMs}`
  return db
    .select({ key: rollups.key, bucket, articles: sql<number>`sum(${rollups.articles})` })
    .from(rollups)
    .where(and(eq(rollups.kind, kind), inArray(rollups.key, keys), gte(rollups.bucket, from), lt(rollups.bucket, to)))
    .groupBy(rollups.key, bucket)
}

/**
 * Stories with an article since `from`, best score first and unscored last, each with its article and distinct source
 * counts. `bucket` keeps those with an article published in it and lets closed stories in, so an old bucket still
 * lists what ran then; `q` keeps titles containing it.
 */
export const rankedStories = async (
  db: Db,
  opts: { from: number; limit: number; bucket?: { from: number; to: number }; q?: string },
) => {
  const { bucket, q } = opts
  const rows = await db
    .select({
      id: stories.id,
      category: stories.category,
      score: stories.score,
      lastArticleAt: stories.lastArticleAt,
      title: stories.title,
      summary: stories.summary,
      origins: stories.independentOrigins,
      momentum24h: stories.momentum24h,
    })
    .from(stories)
    .where(
      and(
        bucket ? inArray(stories.status, ["active", "closed"]) : eq(stories.status, "active"),
        gte(stories.lastArticleAt, bucket?.from ?? opts.from),
        q ? like(stories.title, `%${q}%`) : undefined,
        bucket
          ? inArray(
              stories.id,
              db
                .select({ id: articles.storyId })
                .from(articles)
                .where(and(gte(articles.publishedAt, bucket.from), lt(articles.publishedAt, bucket.to))),
            )
          : undefined,
      ),
    )
    .orderBy(desc(stories.score), desc(stories.lastArticleAt))
    .limit(opts.limit)
  const ids = rows.map((r) => r.id)
  const counts = ids.length
    ? await db
        .select({
          id: articles.storyId,
          articles: sql<number>`count(*)`,
          sources: sql<number>`count(distinct ${articles.sourceId})`,
        })
        .from(articles)
        .where(inArray(articles.storyId, ids))
        .groupBy(articles.storyId)
    : []
  const byId = new Map(counts.map((c) => [c.id, c]))
  return rows.map((r) => ({ ...r, articles: byId.get(r.id)?.articles ?? 0, sources: byId.get(r.id)?.sources ?? 0 }))
}

/** A story's facts, active first, then by salience; `sources` is the supporting article count. */
export const storyFacts = (db: Db, storyId: number, limit: number) =>
  db
    .select({
      id: facts.id,
      text: facts.text,
      status: facts.status,
      sources: sql<number>`json_array_length(${facts.supportingArticleIdsJson})`,
    })
    .from(facts)
    .where(eq(facts.storyId, storyId))
    .orderBy(sql`${facts.status} = 'active' desc`, desc(facts.salience), facts.firstSeen)
    .limit(limit)

/** Would-alert passes since `since` and the latest recorded database size (null before the first record). */
export const opsCounts = async (db: Db, since: number) => {
  const [[alerts], [size]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(gateLog)
      .where(and(eq(gateLog.gate, "alert"), eq(gateLog.decision, "pass"), gte(gateLog.at, since))),
    db.select({ bytes: dbStats.sizeBytes }).from(dbStats).orderBy(desc(dbStats.day)).limit(1),
  ])
  return { wouldAlert: alerts?.n ?? 0, dbBytes: size?.bytes ?? null }
}

/**
 * Everything the story page lists besides the story row and its chart, each list capped at `limit` rows. The
 * article count and best tier are over all of the story's articles; tiers are letters, so the best is the least.
 */
export const storyDetail = async (db: Db, id: number, limit: number) => {
  const [
    factRows,
    articleRows,
    matches,
    vulnRows,
    gates,
    deliveryRows,
    votes,
    signalRows,
    [follow],
    audit,
    [totals],
    mergedIn,
  ] = await Promise.all([
    db.select().from(facts).where(eq(facts.storyId, id)).orderBy(desc(facts.salience), facts.firstSeen).limit(limit),
    storyArticles(db, id).limit(limit),
    // Newest placement first, so the first row per article is the one that stands.
    db
      .select({ articleId: matchLog.articleId, how: matchLog.how, cosine: matchLog.cosine })
      .from(matchLog)
      .innerJoin(articles, eq(articles.id, matchLog.articleId))
      .where(eq(articles.storyId, id))
      .orderBy(desc(matchLog.at), desc(matchLog.id))
      .limit(limit),
    db
      .select(getTableColumns(vulns))
      .from(storyVulns)
      .innerJoin(vulns, eq(vulns.cveId, storyVulns.cveId))
      .where(eq(storyVulns.storyId, id))
      .orderBy(desc(vulns.epss))
      .limit(limit),
    db.select().from(gateLog).where(eq(gateLog.storyId, id)).orderBy(desc(gateLog.at)).limit(limit),
    db.select().from(deliveries).where(eq(deliveries.storyId, id)).orderBy(desc(deliveries.sentAt)).limit(limit),
    db
      .select({ deliveryId: feedback.deliveryId, vote: feedback.vote, n: sql<number>`count(*)` })
      .from(feedback)
      .where(eq(feedback.storyId, id))
      .groupBy(feedback.deliveryId, feedback.vote)
      .limit(limit),
    db.select().from(signals).where(eq(signals.storyId, id)).orderBy(desc(signals.observedAt)).limit(limit),
    db.select().from(follows).where(eq(follows.storyId, id)),
    db
      .select()
      .from(actions)
      .where(and(eq(actions.subjectKind, "story"), eq(actions.subjectId, String(id))))
      .orderBy(desc(actions.at))
      .limit(limit),
    db
      .select({ n: count(), bestTier: min(sources.tier) })
      .from(articles)
      .innerJoin(sources, eq(sources.id, articles.sourceId))
      .where(eq(articles.storyId, id)),
    db
      .select({ id: stories.id, title: stories.title })
      .from(stories)
      .where(eq(stories.mergedInto, id))
      .orderBy(stories.id)
      .limit(limit),
  ])
  return {
    facts: factRows,
    articles: articleRows,
    articleCount: totals?.n ?? 0,
    bestTier: totals?.bestTier ?? null,
    mergedIn,
    matches,
    vulns: vulnRows,
    gates,
    deliveries: deliveryRows,
    votes,
    signals: signalRows,
    follow: follow ?? null,
    audit,
  }
}

/** One article with its source, story and its newest `limit` audit rows, or null. */
export const articleDetail = async (db: Db, id: number, limit: number) => {
  const [[row], audit] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        snippet: articles.snippet,
        canonicalUrl: articles.canonicalUrl,
        publishedAt: articles.publishedAt,
        fetchedAt: articles.fetchedAt,
        originId: articles.originId,
        storyId: articles.storyId,
        storyTitle: stories.title,
        embeddedAt: articles.embeddedAt,
        injectionSuspect: articles.injectionSuspect,
        sourceId: articles.sourceId,
        sourceName: sources.name,
        tier: sources.tier,
      })
      .from(articles)
      .innerJoin(sources, eq(sources.id, articles.sourceId))
      .leftJoin(stories, eq(stories.id, articles.storyId))
      .where(eq(articles.id, id)),
    db
      .select()
      .from(actions)
      .where(and(eq(actions.subjectKind, "article"), eq(actions.subjectId, String(id))))
      .orderBy(desc(actions.at))
      .limit(limit),
  ])
  return row ? { ...row, audit } : null
}

/** Row counts for the data index, one `count(*)` per table in one batch; articles and llm_calls are the slow scans. */
export const tableCounts = async (db: Db) => {
  const counts = await runBatch(
    db,
    TABLES.map((t) => db.select({ n: sql<number>`count(*)` }).from(t.table)),
  )
  return TABLES.map((t, i) => ({ name: t.name, rows: (counts[i] as { n: number }[] | undefined)?.[0]?.n ?? 0 }))
}

export type BrowseFilter = { column: string; op: "eq" | "contains" | "gte" | "lte"; value: string }

/** The table browser's view: filters and the FTS match `q` narrow, the primary key breaks ties in the sort. */
export type BrowseQuery = { filters: BrowseFilter[]; sort: { column?: string; dir: "asc" | "desc" }; q?: string }

type Row = Record<string, unknown>

/** With the FTS match, a four-column keyset and the limit, a page query stays under MAX_PARAMS. */
const MAX_FILTERS = 80
/** Rows per query when exporting. */
const EXPORT_CHUNK = 500

const COMPARE = { eq, gte, lte }

const filterWhere = (meta: TableMeta, filters: BrowseFilter[]) => {
  if (filters.length > MAX_FILTERS) throw new Error(`At most ${MAX_FILTERS} filters`)
  return filters.map((f) => {
    const c = columnOf(meta, f.column)
    if (f.op !== "contains") return COMPARE[f.op](c.column, coerce(c, f.value))
    // `%` and `_` in the value match themselves, not any text.
    return sql`${c.column} like ${`%${f.value.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`
  })
}

const ftsWhere = (meta: TableMeta, q: string | undefined) => {
  if (!q) return undefined
  if (!meta.fts) throw new Error(`Table ${meta.name} has no text search`)
  const fts = sql.identifier(meta.fts.table)
  // Each word quoted, so FTS5 syntax in `q` matches as text instead of failing to parse, and a prefix query.
  const match = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replaceAll('"', '""')}"*`)
    .join(" ")
  const key = columnOf(meta, meta.primaryKey[0] ?? "").column
  return sql`${key} in (select rowid from ${fts} where ${fts} match ${match})`
}

/** The sort column, then the primary key columns it leaves out, so the order is total and a row can resume it. */
const orderOf = (meta: TableMeta, { column }: BrowseQuery["sort"]) =>
  (column ? [column, ...meta.primaryKey.filter((k) => k !== column)] : meta.primaryKey).map((k) => {
    const c = columnOf(meta, k)
    if (c.kind === "json") throw new Error(`${meta.name}.${k} is JSON and cannot be sorted`)
    return c
  })

/**
 * Rows after the cursor's values in `cols` order. SQLite sorts nulls first ascending and last descending; only the
 * sort column can be null, every later column is part of the primary key.
 */
const keysetAfter = (cols: Column[], vals: unknown[], dir: "asc" | "desc"): SQL | undefined => {
  const [c, ...restCols] = cols
  if (!c) return undefined
  const [v, ...restVals] = vals
  const rest = keysetAfter(restCols, restVals, dir)
  if (v === null) return dir === "asc" ? or(and(isNull(c), rest), isNotNull(c)) : and(isNull(c), rest)
  return or((dir === "asc" ? gt : lt)(c, v), rest && and(eq(c, v), rest), dir === "desc" ? isNull(c) : undefined)
}

const browseRows = async (db: Db, meta: TableMeta, query: BrowseQuery, cursor: Row | null, limit: number) => {
  const order = orderOf(meta, query.sort)
  const by = query.sort.dir === "asc" ? asc : desc
  const after = cursor
    ? keysetAfter(
        order.map((c) => c.column),
        order.map((c) => cursor[c.name]),
        query.sort.dir,
      )
    : undefined
  const rows: Row[] = await db
    .select()
    .from(meta.table)
    .where(and(...filterWhere(meta, query.filters), ftsWhere(meta, query.q), after))
    .orderBy(...order.map((c) => by(c.column)))
    .limit(limit)
  return rows
}

/** One row by its row ID (see rowId), or null. */
export const rowById = async (db: Db, meta: TableMeta, id: string) => {
  const [row] = await db.select().from(meta.table).where(rowWhere(meta, id)).limit(1)
  return (row as Row | undefined) ?? null
}

/**
 * A page of the table browser: keyset paging after the row ID `after`, in the sort column then the primary key. `next`
 * is the row ID to pass as `after` for the following page, null on the last one. The cursor is only the row ID, so
 * its sort value is read again: a row whose sort value changes between pages can be skipped or shown twice.
 */
export const browseTable = async (db: Db, meta: TableMeta, opts: BrowseQuery & { after?: string; limit: number }) => {
  const cursor = opts.after === undefined ? null : await rowById(db, meta, opts.after)
  if (opts.after !== undefined && !cursor) throw new Error(`No ${meta.name} row ${opts.after} to page after`)
  const rows = await browseRows(db, meta, opts, cursor, opts.limit + 1)
  const last = rows.length > opts.limit ? rows[opts.limit - 1] : undefined
  return { rows: rows.slice(0, opts.limit), next: last ? rowId(meta, last) : null }
}

/** Every row the browser would page through for `query`, up to `max`, in chunks for a streamed export. */
export async function* exportRows(db: Db, meta: TableMeta, query: BrowseQuery, max: number) {
  let cursor: Row | null = null
  for (let left = max; left > 0; ) {
    const rows = await browseRows(db, meta, query, cursor, Math.min(EXPORT_CHUNK, left))
    yield rows
    left -= rows.length
    cursor = rows.at(-1) ?? null
    if (rows.length < EXPORT_CHUNK) return
  }
}

/** An FTS5 prefix query for `q`, each word quoted so FTS5 syntax in it matches as text instead of failing to parse. */
export const ftsMatch = (q: string) =>
  q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replaceAll('"', '""')}"*`)
    .join(" ")

/** Entities not merged away, most stories first; `q` searches their names. */
export const entityList = (db: Db, opts: { q?: string; limit: number }) => {
  const match = ftsMatch(opts.q ?? "")
  return db
    .select({
      id: entities.id,
      key: entities.key,
      name: entities.name,
      kind: entities.kind,
      storyCount: entities.storyCount,
      momentum24h: entities.momentum24h,
      lastSeen: entities.lastSeen,
    })
    .from(entities)
    .where(
      and(
        isNull(entities.mergedInto),
        match ? sql`${entities.id} in (select rowid from entities_fts where entities_fts match ${match})` : undefined,
      ),
    )
    .orderBy(desc(entities.storyCount), desc(entities.lastSeen))
    .limit(opts.limit)
}

/** A story's entities that were not merged away, most stories first. */
export const storyEntityList = (db: Db, storyId: number, limit: number) =>
  db
    .select({ key: entities.key, name: entities.name, kind: entities.kind, momentum24h: entities.momentum24h })
    .from(storyEntities)
    .innerJoin(entities, eq(entities.id, storyEntities.entityId))
    .where(and(eq(storyEntities.storyId, storyId), isNull(entities.mergedInto)))
    .orderBy(desc(entities.storyCount))
    .limit(limit)

/** Each story with its article and distinct source counts, as rankedStories counts them. */
const withStoryCounts = async <T extends { id: number }>(db: Db, rows: T[]) => {
  const ids = rows.map((r) => r.id)
  const counts = ids.length
    ? await db
        .select({
          id: articles.storyId,
          articles: sql<number>`count(*)`,
          sources: sql<number>`count(distinct ${articles.sourceId})`,
        })
        .from(articles)
        .where(inArray(articles.storyId, ids))
        .groupBy(articles.storyId)
    : []
  const byId = new Map(counts.map((c) => [c.id, c]))
  return rows.map((r) => ({ ...r, articles: byId.get(r.id)?.articles ?? 0, sources: byId.get(r.id)?.sources ?? 0 }))
}

/** Day start of a story link's first-seen time. */
const linkDay = sql<number>`(${storyEntities.firstSeen} / 86400000) * 86400000`

/**
 * The entity page's lists: up to `limit` aliases, up to `limit` unmerged stories newest first with their counts, and
 * new story links per day since `since` (empty days are missing).
 */
export const entityDetail = async (db: Db, id: number, opts: { since: number; limit: number }) => {
  const [aliases, rows, storiesPerDay] = await Promise.all([
    db
      .select({ id: entities.id, key: entities.key, name: entities.name })
      .from(entities)
      .where(eq(entities.mergedInto, id))
      .orderBy(entities.name)
      .limit(opts.limit),
    db
      .select({
        id: stories.id,
        category: stories.category,
        score: stories.score,
        lastArticleAt: stories.lastArticleAt,
        title: stories.title,
        summary: stories.summary,
        origins: stories.independentOrigins,
        momentum24h: stories.momentum24h,
      })
      .from(storyEntities)
      .innerJoin(stories, eq(stories.id, storyEntities.storyId))
      .where(and(eq(storyEntities.entityId, id), ne(stories.status, "merged")))
      .orderBy(desc(storyEntities.firstSeen))
      .limit(opts.limit),
    db
      .select({ day: linkDay, n: count() })
      .from(storyEntities)
      .where(and(eq(storyEntities.entityId, id), gte(storyEntities.firstSeen, opts.since)))
      .groupBy(linkDay),
  ])
  return { aliases, stories: await withStoryCounts(db, rows), storiesPerDay }
}

const HOUR = 3_600_000

/** Theme links a reader sees: detaching a story keeps its link for the audit trail, with confidence 0. */
const themeLinked = gt(storyThemes.confidence, 0)

/** Momentum over the `hours` before `now`'s hour: the stored column for 24 hours and 7 days, else from rollups. */
const themeMomentumOver = (hours: number, now: number) => {
  if (hours === 24) return sql<number | null>`${themes.momentum24h}`
  if (hours === 7 * 24) return sql<number | null>`${themes.momentum7d}`
  return themeMomentum(Math.floor(now / HOUR) * HOUR, hours)
}

/**
 * Themes in `statuses` with their momentum over `hours`: the largest swing first (a rise from 0 the largest) or the
 * latest story first. `q` searches names and descriptions.
 */
export const themeList = (
  db: Db,
  o: {
    statuses: ThemeStatus[]
    hours: number
    now: number
    order: "swing" | "recent"
    limit: number
    offset?: number
    q?: string
  },
) => {
  const momentum = themeMomentumOver(o.hours, o.now)
  const match = ftsMatch(o.q ?? "")
  return db
    .select({
      id: themes.id,
      name: themes.name,
      description: themes.description,
      status: themes.status,
      storyCount: themes.storyCount,
      firstSeen: themes.firstSeen,
      lastSeen: themes.lastSeen,
      explanation: themes.explanation,
      momentum,
    })
    .from(themes)
    .where(
      and(
        inArray(themes.status, o.statuses),
        match ? sql`${themes.id} in (select rowid from themes_fts where themes_fts match ${match})` : undefined,
      ),
    )
    .orderBy(
      ...(o.order === "swing" ? [desc(sql`abs(coalesce(${momentum}, 1e9))`)] : []),
      desc(themes.lastSeen),
      desc(themes.id),
    )
    .limit(o.limit)
    .offset(o.offset ?? 0)
}

/** The streams of each theme's linked unmerged stories. */
export const themeStreams = (db: Db, themeIds: number[]) =>
  themeIds.length === 0
    ? Promise.resolve([])
    : db
        .selectDistinct({ themeId: storyThemes.themeId, category: stories.category })
        .from(storyThemes)
        .innerJoin(stories, eq(stories.id, storyThemes.storyId))
        .where(and(inArray(storyThemes.themeId, themeIds), themeLinked, ne(stories.status, "merged")))

/** Active themes rising over the `hours` before `now`'s hour, and in the window before; a rise from 0 counts. */
export const risingThemes = async (db: Db, hours: number, now: number) => {
  const rising = (m: SQL) => sql<number>`coalesce(sum(coalesce(${m}, 1) > 0), 0)`
  const [row] = await db
    .select({
      recent: rising(themeMomentumOver(hours, now)),
      previous: rising(themeMomentum(Math.floor(now / HOUR) * HOUR - hours * HOUR, hours)),
    })
    .from(themes)
    .where(eq(themes.status, "active"))
  return { recent: row?.recent ?? 0, previous: row?.previous ?? 0 }
}

type ThemeChip = { id: number; name: string; momentum24h: number | null }

/** Active and closed themes linked to these stories, most stories first, by story id. */
export const storyThemeChips = async (db: Db, storyIds: number[]) => {
  const rows = storyIds.length
    ? await db
        .select({
          storyId: storyThemes.storyId,
          id: themes.id,
          name: themes.name,
          momentum24h: themes.momentum24h,
        })
        .from(storyThemes)
        .innerJoin(themes, eq(themes.id, storyThemes.themeId))
        .where(and(inArray(storyThemes.storyId, storyIds), themeLinked, inArray(themes.status, ["active", "closed"])))
        .orderBy(desc(themes.storyCount))
    : []
  const out = new Map<number, ThemeChip[]>()
  for (const { storyId, ...chip } of rows) out.set(storyId, [...(out.get(storyId) ?? []), chip])
  return out
}

/**
 * The signal page's lists: up to `stories` linked unmerged stories newest first with their counts, up to `rows` of
 * their join times oldest first, up to `entities` entities of those stories, most shared first, and up to `rows`
 * events, newest first.
 */
export const themeDetail = async (db: Db, id: number, o: { stories: number; entities: number; rows: number }) => {
  const linkedStories = and(eq(storyThemes.themeId, id), themeLinked, ne(stories.status, "merged"))
  const shared = count()
  const [storyRows, joins, entityRows, events] = await Promise.all([
    db
      .select({
        id: stories.id,
        category: stories.category,
        score: stories.score,
        lastArticleAt: stories.lastArticleAt,
        title: stories.title,
        summary: stories.summary,
        origins: stories.independentOrigins,
        momentum24h: stories.momentum24h,
      })
      .from(storyThemes)
      .innerJoin(stories, eq(stories.id, storyThemes.storyId))
      .where(linkedStories)
      .orderBy(desc(stories.firstSeen))
      .limit(o.stories),
    db
      .select({ storyId: stories.id, title: stories.title, at: storyThemes.assignedAt })
      .from(storyThemes)
      .innerJoin(stories, eq(stories.id, storyThemes.storyId))
      .where(linkedStories)
      .orderBy(storyThemes.assignedAt)
      .limit(o.rows),
    db
      .select({
        key: entities.key,
        name: entities.name,
        kind: entities.kind,
        momentum24h: entities.momentum24h,
        stories: shared,
      })
      .from(storyThemes)
      .innerJoin(stories, eq(stories.id, storyThemes.storyId))
      .innerJoin(storyEntities, eq(storyEntities.storyId, storyThemes.storyId))
      .innerJoin(entities, eq(entities.id, storyEntities.entityId))
      .where(and(linkedStories, isNull(entities.mergedInto)))
      .groupBy(entities.id)
      .orderBy(desc(shared), desc(entities.storyCount))
      .limit(o.entities),
    db
      .select()
      .from(themeEvents)
      .where(eq(themeEvents.themeId, id))
      .orderBy(desc(themeEvents.at), desc(themeEvents.id))
      .limit(o.rows),
  ])
  return { stories: await withStoryCounts(db, storyRows), joins, entities: entityRows, events }
}
