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
import { alias } from "drizzle-orm/sqlite-core"
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
  type Gate,
  type GateDecision,
  gateLog,
  hourlyRuns,
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
      .orderBy(desc(storyThemes.assignedAt))
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

type Pair = { source: number; target: number; shared: number }

/**
 * The front page network: up to `limit` active stories with an article since `from` (as rankedStories), most articles
 * first, and every pair of them sharing linked unmerged signals or unmerged entities, the lower story id as `source`.
 * A link's weight is the shared count up to `maxWeight`, and it keeps one shared signal, else one shared entity key,
 * to link to. The pairs select the stories as a subquery rather than an ID list, and one batch reads all three, so
 * every link joins two of the returned stories.
 */
export const storyNetwork = async (db: Db, o: { from: number; limit: number; maxWeight: number }) => {
  const nodes = db
    .select({
      id: stories.id,
      category: stories.category,
      title: stories.title,
      articles: sql<number>`count(*)`.as("articles"),
    })
    .from(stories)
    .innerJoin(articles, eq(articles.storyId, stories.id))
    .where(and(eq(stories.status, "active"), gte(stories.lastArticleAt, o.from)))
    .groupBy(stories.id)
    .orderBy(desc(sql`count(*)`), stories.id)
    .limit(o.limit)
  const top = nodes.as("top")
  const ids = db.select({ id: top.id }).from(top)
  const [a, b] = [alias(storyThemes, "a"), alias(storyThemes, "b")]
  const themePairs = db
    .select({ source: a.storyId, target: b.storyId, shared: count(), themeId: min(a.themeId) })
    .from(a)
    .innerJoin(b, and(eq(b.themeId, a.themeId), lt(a.storyId, b.storyId)))
    .innerJoin(themes, eq(themes.id, a.themeId))
    .where(
      and(
        gt(a.confidence, 0),
        gt(b.confidence, 0),
        ne(themes.status, "merged"),
        inArray(a.storyId, ids),
        inArray(b.storyId, ids),
      ),
    )
    .groupBy(a.storyId, b.storyId)
  const [e, f] = [alias(storyEntities, "e"), alias(storyEntities, "f")]
  const entityPairs = db
    .select({ source: e.storyId, target: f.storyId, shared: count(), key: min(entities.key) })
    .from(e)
    .innerJoin(f, and(eq(f.entityId, e.entityId), lt(e.storyId, f.storyId)))
    .innerJoin(entities, eq(entities.id, e.entityId))
    .where(and(isNull(entities.mergedInto), inArray(e.storyId, ids), inArray(f.storyId, ids)))
    .groupBy(e.storyId, f.storyId)
  const [nodeRows, themeRows, entityRows] = await db.batch([nodes, themePairs, entityPairs])
  const links = new Map<string, Pair & { themeId: number | null; entityKey: string | null }>()
  const add = ({ source, target, shared }: Pair, themeId: number | null, entityKey: string | null) => {
    const l = links.get(`${source}/${target}`) ?? { source, target, shared: 0, themeId: null, entityKey: null }
    l.shared += shared
    l.themeId ??= themeId
    l.entityKey ??= entityKey
    links.set(`${source}/${target}`, l)
  }
  for (const r of themeRows) add(r, r.themeId, null)
  for (const r of entityRows) add(r, null, r.key)
  return {
    nodes: nodeRows,
    links: [...links.values()].map(({ shared, ...l }) => ({ ...l, weight: Math.min(o.maxWeight, shared) })),
  }
}

/** Day start of a rollup bucket; the literal keeps it integer division. */
const rollupDay = sql<number>`(${rollups.bucket} / 86400000) * 86400000`

/**
 * The newest time a source's row shows a successful poll: a healthy poll schedules the next one an interval ahead, so
 * the last one ran an interval before `nextPollAt`; a failing source falls back to its newest item. Null when neither.
 */
const lastOkAt = sql<number | null>`nullif(max(coalesce(${sources.lastNewItemAt}, 0),
  case when ${sources.consecutiveFailures} = 0 and ${sources.lastStatus} > 0 and ${sources.lastStatus} < 400
  then ${sources.nextPollAt} - ${sources.pollSeconds} * 1000 else 0 end), 0)`

/** Every source with its poll state, and articles per source and UTC day in [from, to) (empty days are missing). */
export const sourceList = async (db: Db, from: number, to: number) => {
  const [rows, days] = await db.batch([
    db
      .select({
        id: sources.id,
        name: sources.name,
        tier: sources.tier,
        category: sources.category,
        enabled: sources.enabled,
        pollSeconds: sources.pollSeconds,
        lastStatus: sources.lastStatus,
        consecutiveFailures: sources.consecutiveFailures,
        nextPollAt: sources.nextPollAt,
        items24h: sources.items24h,
        lastOkAt,
      })
      .from(sources),
    db
      .select({ key: rollups.key, bucket: rollupDay, articles: sql<number>`sum(${rollups.articles})` })
      .from(rollups)
      .where(and(eq(rollups.kind, "source"), gte(rollups.bucket, from), lt(rollups.bucket, to)))
      .groupBy(rollups.key, rollupDay),
  ])
  return { rows, days }
}

/** UTC day start of a unix ms column; the literal keeps it integer division. */
const utcDay = (at: Column) => sql<number>`(${at} / 86400000) * 86400000`

/**
 * Claude spend since `from`: USD and calls per UTC day and purpose, each day's dearest first, and per purpose and
 * model, dearest first.
 */
export const spendByDay = async (db: Db, from: number) => {
  const day = utcDay(llmCalls.at)
  const usd = sql<number>`sum(${llmCalls.estCostUsd})`
  const [days, models] = await db.batch([
    db
      .select({ day, purpose: llmCalls.purpose, usd, calls: count() })
      .from(llmCalls)
      .where(gte(llmCalls.at, from))
      .groupBy(day, llmCalls.purpose)
      .orderBy(day, desc(usd)),
    db
      .select({ purpose: llmCalls.purpose, model: llmCalls.model, usd, calls: count() })
      .from(llmCalls)
      .where(gte(llmCalls.at, from))
      .groupBy(llmCalls.purpose, llmCalls.model)
      .orderBy(desc(usd)),
  ])
  return { days, models }
}

/** Distinct stories StoryEval extracted per UTC day since `from`; empty days are missing. */
export const evaluatedPerDay = (db: Db, from: number) => {
  const day = utcDay(llmCalls.at)
  return db
    .select({ day, stories: sql<number>`count(distinct ${llmCalls.storyId})` })
    .from(llmCalls)
    .where(and(eq(llmCalls.purpose, "extraction"), gte(llmCalls.at, from)))
    .groupBy(day)
}

export type GateLogFilter = { gate?: Gate; decision?: GateDecision; shadow?: boolean; from?: number; to?: number }

/**
 * A page of gate decisions with their story titles, newest first by ID (IDs rise with `at`), after the ID `after`.
 * `next` is the ID to pass as `after` for the following page, null on the last one.
 */
export const gateLogPage = async (db: Db, f: GateLogFilter & { after?: number; limit: number }) => {
  const rows = await db
    .select({
      id: gateLog.id,
      storyId: gateLog.storyId,
      title: stories.title,
      gate: gateLog.gate,
      decision: gateLog.decision,
      reasons: gateLog.reasonsJson,
      shadow: gateLog.shadow,
      at: gateLog.at,
    })
    .from(gateLog)
    .innerJoin(stories, eq(stories.id, gateLog.storyId))
    .where(
      and(
        f.gate && eq(gateLog.gate, f.gate),
        f.decision && eq(gateLog.decision, f.decision),
        f.shadow === undefined ? undefined : eq(gateLog.shadow, f.shadow),
        f.from === undefined ? undefined : gte(gateLog.at, f.from),
        f.to === undefined ? undefined : lt(gateLog.at, f.to),
        f.after === undefined ? undefined : lt(gateLog.id, f.after),
      ),
    )
    .orderBy(desc(gateLog.id))
    .limit(f.limit + 1)
  return { rows: rows.slice(0, f.limit), next: rows.length > f.limit ? (rows[f.limit - 1]?.id ?? null) : null }
}

/** The newest `limit` daily database measurements, newest first. */
export const dbSizes = (db: Db, limit: number) => db.select().from(dbStats).orderBy(desc(dbStats.day)).limit(limit)

/**
 * Story deliveries and their votes per score band, lowest first. The band is how many of `bounds` the score at send
 * reaches (the story's current score when the delivery kept none), as core's scoreTier counts; null when neither.
 */
export const calibrationBands = (db: Db, bounds: number[]) => {
  const score = sql`coalesce(${deliveries.scoreAtSend}, ${stories.score})`
  const reached = sql.join([sql`0`, ...bounds.map((b) => sql`(${score} >= ${b})`)], sql` + `)
  const band = sql<number | null>`case when ${score} is null then null else ${reached} end`
  return db
    .select({
      band,
      stories: sql<number>`count(distinct ${deliveries.storyId})`,
      up: sql<number>`coalesce(sum(${feedback.vote} = 'up'), 0)`,
      down: sql<number>`coalesce(sum(${feedback.vote} = 'down'), 0)`,
    })
    .from(deliveries)
    .innerJoin(stories, eq(stories.id, deliveries.storyId))
    .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
    .groupBy(band)
    .orderBy(band)
}

/** Every hourly step's last run, and the newest rollup write per kind among buckets since `since`. */
export const loopHealth = async (db: Db, since: number) => {
  const [runs, kinds] = await db.batch([
    db.select().from(hourlyRuns).orderBy(hourlyRuns.step),
    db
      .select({ kind: rollups.kind, updatedAt: sql<number>`max(${rollups.updatedAt})` })
      .from(rollups)
      .where(gte(rollups.bucket, since))
      .groupBy(rollups.kind),
  ])
  return { runs, rollups: kinds }
}

const votes = (vote: "up" | "down") => sql<number>`coalesce(sum(${feedback.vote} = ${vote}), 0)`

/**
 * Daily digest editions dated in [from, to) (YYYY-MM-DD), newest first: each date with digest or update deliveries,
 * its count of distinct stories and its votes over every chat.
 */
export const digestEditions = (db: Db, from: string, to: string, limit?: number) => {
  const q = db
    .select({
      date: sql<string>`${deliveries.digestDate}`,
      items: sql<number>`count(distinct ${deliveries.storyId})`,
      up: votes("up"),
      down: votes("down"),
    })
    .from(deliveries)
    .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
    .where(
      and(
        inArray(deliveries.kind, ["digest", "update"]),
        gte(deliveries.digestDate, from),
        lt(deliveries.digestDate, to),
      ),
    )
    .groupBy(deliveries.digestDate)
    .orderBy(desc(deliveries.digestDate))
  return limit === undefined ? q : q.limit(limit)
}

/**
 * The stories of the digest dated `date` and the alerts sent in [from, to), in send order, each story once per kind
 * with the stored fields a digest item is rendered from, its score at send and its votes over every chat.
 */
export const digestDay = (db: Db, date: string, from: number, to: number) => {
  const sentAt = sql<number>`min(${deliveries.sentAt})`
  return db
    .select({
      storyId: stories.id,
      kind: deliveries.kind,
      sentAt,
      scoreAtSend: sql<number | null>`max(${deliveries.scoreAtSend})`,
      up: votes("up"),
      down: votes("down"),
      category: stories.category,
      fiRelevance: stories.fiRelevance,
      title: stories.title,
      summary: stories.summary,
      independentOrigins: stories.independentOrigins,
    })
    .from(deliveries)
    .innerJoin(stories, eq(stories.id, deliveries.storyId))
    .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
    .where(
      or(
        eq(deliveries.digestDate, date),
        and(eq(deliveries.kind, "alert"), gte(deliveries.sentAt, from), lt(deliveries.sentAt, to)),
      ),
    )
    .groupBy(stories.id, deliveries.kind)
    .orderBy(sentAt)
}

/** The story columns an on-demand answer reads, before withStoryCounts adds the counts. */
const answerStoryColumns = {
  id: stories.id,
  category: stories.category,
  status: stories.status,
  score: stories.score,
  title: stories.title,
  summary: stories.summary,
  origins: stories.independentOrigins,
  momentum24h: stories.momentum24h,
  firstSeen: stories.firstSeen,
  lastArticleAt: stories.lastArticleAt,
}

/** Supporting articles of a fact, as storyFacts counts them. */
const factSources = sql<number>`json_array_length(${facts.supportingArticleIdsJson})`

/** Unmerged stories first seen in [from, to): the `limit` with the most independent origins, oldest first, counted. */
export const storiesFirstSeenBetween = async (db: Db, from: number, to: number, limit: number) => {
  const rows = await db
    .select(answerStoryColumns)
    .from(stories)
    .where(and(ne(stories.status, "merged"), gte(stories.firstSeen, from), lt(stories.firstSeen, to)))
    .orderBy(desc(stories.independentOrigins), desc(stories.firstSeen))
    .limit(limit)
  return withStoryCounts(
    db,
    rows.sort((a, b) => a.firstSeen - b.firstSeen),
  )
}

/**
 * Unmerged stories that joined a theme (links a reader sees) or met an entity since `since`: the newest `limit`,
 * oldest first, each with when it joined and its counts.
 */
export const storiesJoinedSince = async (
  db: Db,
  kind: "theme" | "entity",
  id: number,
  o: { since: number; limit: number },
) => {
  const unmerged = ne(stories.status, "merged")
  const rows = await (kind === "theme"
    ? db
        .select({ ...answerStoryColumns, joinedAt: storyThemes.assignedAt })
        .from(storyThemes)
        .innerJoin(stories, eq(stories.id, storyThemes.storyId))
        .where(and(eq(storyThemes.themeId, id), themeLinked, unmerged, gte(storyThemes.assignedAt, o.since)))
        .orderBy(desc(storyThemes.assignedAt))
        .limit(o.limit)
    : db
        .select({ ...answerStoryColumns, joinedAt: storyEntities.firstSeen })
        .from(storyEntities)
        .innerJoin(stories, eq(stories.id, storyEntities.storyId))
        .where(and(eq(storyEntities.entityId, id), unmerged, gte(storyEntities.firstSeen, o.since)))
        .orderBy(desc(storyEntities.firstSeen))
        .limit(o.limit))
  return withStoryCounts(db, rows.toReversed())
}

/** A story's facts first seen since `since`: the newest `limit`, oldest first. */
export const storyFactsSince = async (db: Db, storyId: number, since: number, limit: number) => {
  const rows = await db
    .select({ id: facts.id, text: facts.text, status: facts.status, firstSeen: facts.firstSeen, sources: factSources })
    .from(facts)
    .where(and(eq(facts.storyId, storyId), gte(facts.firstSeen, since)))
    .orderBy(desc(facts.firstSeen), desc(facts.id))
    .limit(limit)
  return rows.toReversed()
}

/** These unmerged stories by id, with their counts and up to `factsEach` active facts each, most salient first. */
export const storiesWithFacts = async (db: Db, ids: number[], factsEach: number) => {
  if (ids.length === 0) return []
  const [rows, factRows] = await Promise.all([
    db
      .select(answerStoryColumns)
      .from(stories)
      .where(and(inArray(stories.id, ids), ne(stories.status, "merged")))
      .orderBy(stories.id),
    factsEach > 0
      ? db
          .select({ storyId: facts.storyId, text: facts.text, status: facts.status, sources: factSources })
          .from(facts)
          .where(and(inArray(facts.storyId, ids), eq(facts.status, "active")))
          .orderBy(desc(facts.salience), facts.firstSeen)
      : [],
  ])
  const byStory = new Map<number, typeof factRows>()
  for (const f of factRows) {
    const list = byStory.get(f.storyId) ?? []
    if (list.length < factsEach) byStory.set(f.storyId, [...list, f])
  }
  return (await withStoryCounts(db, rows)).map((s) => ({ ...s, facts: byStory.get(s.id) ?? [] }))
}

/**
 * The best FTS5 matches for a question: up to `limit` unmerged stories, with up to `factsEach` facts each, and up to
 * `limit` active or closed themes. A question matches on any of its words, where ftsMatch needs every word.
 */
export const askHits = async (db: Db, question: string, o: { limit: number; factsEach: number }) => {
  const match = question
    .split(/[^\p{L}\p{N}]+/u)
    .map(ftsMatch)
    .filter(Boolean)
    .join(" OR ")
  if (!match) return { stories: [], signals: [] }
  const [storyRows, signals] = await Promise.all([
    db
      .select({ id: stories.id })
      .from(stories)
      .where(
        sql`${stories.id} in (select rowid from stories_fts where stories_fts match ${match} order by rank limit ${o.limit})`,
      ),
    db
      .select({
        id: themes.id,
        name: themes.name,
        description: themes.description,
        status: themes.status,
        storyCount: themes.storyCount,
        momentum24h: themes.momentum24h,
        momentum7d: themes.momentum7d,
        explanation: themes.explanation,
      })
      .from(themes)
      .where(
        and(
          inArray(themes.status, ["active", "closed"]),
          sql`${themes.id} in (select rowid from themes_fts where themes_fts match ${match} order by rank limit ${o.limit})`,
        ),
      )
      .orderBy(desc(themes.lastSeen)),
  ])
  return {
    stories: await storiesWithFacts(
      db,
      storyRows.map((r) => r.id),
      o.factsEach,
    ),
    signals,
  }
}
