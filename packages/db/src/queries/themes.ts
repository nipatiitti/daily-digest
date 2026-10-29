import { and, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { chunkRows, type Db, runBatch } from "../client.ts"
import {
  articles,
  rollups,
  stories,
  storyEntities,
  storyThemes,
  type Theme,
  themeEvents,
  themes,
} from "../schema/index.ts"

/** Themes a story can join or a run may close. */
const LIVE = ["provisional", "active"] as const

/** Rows read or written per statement: keeps D1 result sets small and ID lists under the parameter limit. */
const PAGE = 200

/** ID lists of at most 50, leaving room for a statement's other parameters. */
const idChunks = <T>(ids: T[]) => chunkRows(ids, 2)

/** Links that count: detaching a story keeps its link for the audit trail, with confidence 0. */
const linked = gt(storyThemes.confidence, 0)

/** Unmerged stories linked to the theme in the current row, for `storyCount`. */
const storyCountSql = sql<number>`(select count(*) from ${storyThemes} inner join ${stories}
  on ${stories.id} = ${storyThemes.storyId}
  where ${storyThemes.themeId} = ${themes.id} and ${linked} and ${stories.status} != 'merged')`

/** The insert for one event, to put in a caller's batch. */
export const recordThemeEvent = (db: Db, event: typeof themeEvents.$inferInsert) => db.insert(themeEvents).values(event)

export const themeById = async (db: Db, id: number) => {
  const [row] = await db.select().from(themes).where(eq(themes.id, id))
  return row ?? null
}

/**
 * Live themes whose unmerged stories share at least `min` entities with this story, most shared first. Bounded by the
 * story's own links (at most ENTITIES.maxPerStory), the stories of live themes and `limit`.
 */
export const candidateThemesByEntities = (db: Db, storyId: number, min: number, limit: number) => {
  const other = alias(storyEntities, "other")
  const shared = sql<number>`count(distinct ${other.entityId})`
  const liveStoryIds = db
    .select({ storyId: storyThemes.storyId })
    .from(storyThemes)
    .innerJoin(themes, eq(themes.id, storyThemes.themeId))
    .where(and(linked, inArray(themes.status, LIVE)))
  return db
    .select({ id: storyThemes.themeId, shared })
    .from(storyEntities)
    .innerJoin(
      other,
      and(eq(other.entityId, storyEntities.entityId), ne(other.storyId, storyId), inArray(other.storyId, liveStoryIds)),
    )
    .innerJoin(stories, and(eq(stories.id, other.storyId), ne(stories.status, "merged")))
    .innerJoin(storyThemes, eq(storyThemes.storyId, other.storyId))
    .innerJoin(themes, eq(themes.id, storyThemes.themeId))
    .where(and(eq(storyEntities.storyId, storyId), linked, inArray(themes.status, LIVE)))
    .groupBy(storyThemes.themeId)
    .having(gte(shared, min))
    .orderBy(desc(shared))
    .limit(limit)
}

/** Every provisional and active theme with its embedding, read in pages of PAGE by id. */
export const activeThemesWithEmbeddings = async (db: Db) => {
  const out: Pick<Theme, "id" | "name" | "description" | "status" | "embedding">[] = []
  for (let after = 0; ; ) {
    const page = await db
      .select({
        id: themes.id,
        name: themes.name,
        description: themes.description,
        status: themes.status,
        embedding: themes.embedding,
      })
      .from(themes)
      .where(and(inArray(themes.status, LIVE), gt(themes.id, after)))
      .orderBy(themes.id)
      .limit(PAGE)
    out.push(...page)
    const last = page.at(-1)
    if (page.length < PAGE || !last) return out
    after = last.id
  }
}

/** Up to `perTheme` titles of each theme's latest unmerged stories, by theme id. */
export const themeExamples = async (db: Db, themeIds: number[], perTheme: number) => {
  const pages = await runBatch(
    db,
    idChunks(themeIds).map((ids) => {
      const ranked = db
        .select({
          themeId: storyThemes.themeId,
          title: stories.title,
          rank: sql<number>`row_number() over (partition by ${storyThemes.themeId}
            order by ${stories.lastArticleAt} desc)`.as("rank"),
        })
        .from(storyThemes)
        .innerJoin(stories, eq(stories.id, storyThemes.storyId))
        .where(and(inArray(storyThemes.themeId, ids), linked, ne(stories.status, "merged")))
        .as("ranked")
      return db
        .select({ themeId: ranked.themeId, title: ranked.title })
        .from(ranked)
        .where(lte(ranked.rank, perTheme))
        .orderBy(ranked.themeId, sql`${ranked.rank}`)
    }),
  )
  const out = new Map<number, string[]>()
  for (const r of (pages as { themeId: number; title: string }[][]).flat()) {
    out.set(r.themeId, [...(out.get(r.themeId) ?? []), r.title])
  }
  return out
}

/** A provisional theme founded by one story, its link and a `created` event, in one batch. Returns the theme id. */
export const createTheme = async (
  db: Db,
  t: {
    name: string
    description: string
    embedding: Float32Array
    firstSeen: number
    storyId: number
    confidence: number
    by: string
  },
) => {
  // The batch is one transaction and ids autoincrement, so the newest id is the theme just inserted.
  const themeId = sql<number>`(select max(${themes.id}) from ${themes})`
  const [, , , [created]] = (await runBatch(db, [
    db.insert(themes).values({
      name: t.name,
      description: t.description,
      embedding: t.embedding,
      firstSeen: t.firstSeen,
      lastSeen: t.firstSeen,
      storyCount: 1,
    }),
    db.insert(storyThemes).values({ storyId: t.storyId, themeId, confidence: t.confidence, by: t.by }),
    db.insert(themeEvents).values({ themeId, kind: "created", detailJson: { storyId: t.storyId, by: t.by } }),
    db.select({ id: sql<number>`max(${themes.id})` }).from(themes),
  ])) as [unknown, unknown, unknown, { id: number }[]]
  if (!created) throw new Error("Theme insert returned no row")
  return created.id
}

/**
 * Link a story to a theme, or to the theme it was merged into, if it is not yet, move `lastSeen` and recount; a closed
 * theme reopens as active. A story detached from that theme writes nothing. Returns the theme linked.
 */
export const assignStoryTheme = async (
  db: Db,
  a: { storyId: number; themeId: number; confidence: number; by: string; at: number },
) => {
  const linkOf = async (themeId: number) => {
    const [row] = await db
      .select({ confidence: storyThemes.confidence })
      .from(storyThemes)
      .where(and(eq(storyThemes.storyId, a.storyId), eq(storyThemes.themeId, themeId)))
    return row ?? null
  }
  let [theme, existing] = await Promise.all([themeById(db, a.themeId), linkOf(a.themeId)])
  for (let hop = 0; hop < 5 && theme?.status === "merged" && theme.mergedInto !== null; hop++) {
    theme = await themeById(db, theme.mergedInto)
  }
  if (!theme) throw new Error(`No theme ${a.themeId}`)
  if (theme.status === "merged") throw new Error(`Theme ${a.themeId} merges through more than 5 themes`)
  const themeId = theme.id
  if (themeId !== a.themeId) existing = await linkOf(themeId)
  // A detached story stays out: no lastSeen move, recount or reopen.
  if (existing?.confidence === 0) return { reopened: false, themeId }
  const reopen = theme.status === "closed"
  await runBatch(db, [
    // An existing row wins, so a live link keeps its confidence and time.
    db
      .insert(storyThemes)
      .values({ storyId: a.storyId, themeId, confidence: a.confidence, assignedAt: a.at, by: a.by })
      .onConflictDoNothing(),
    db
      .update(themes)
      .set({
        lastSeen: sql`max(${themes.lastSeen}, ${a.at})`,
        storyCount: storyCountSql,
        ...(reopen ? { status: "active" as const } : {}),
      })
      .where(eq(themes.id, themeId)),
    ...(reopen
      ? [recordThemeEvent(db, { themeId, kind: "reopened", detailJson: { storyId: a.storyId, by: a.by } })]
      : []),
  ])
  return { reopened: reopen, themeId }
}

/**
 * Merge `fromId` into `intoId`: its links are copied to the target with their confidence, so a detached link stays
 * detached (the old rows stay, for the audit trail), it is marked merged, both get a `merged` event, and the target's
 * seen range and count are refreshed.
 */
export const mergeTheme = async (db: Db, fromId: number, intoId: number, by: string) => {
  if (fromId === intoId) throw new Error("A theme cannot merge into itself")
  const [from, into] = await Promise.all([themeById(db, fromId), themeById(db, intoId)])
  if (!from || !into) throw new Error(`No theme ${from ? intoId : fromId}`)
  if (from.status === "merged" || into.status === "merged") throw new Error("A merged theme cannot merge again")
  await runBatch(db, [
    db
      .insert(storyThemes)
      .select(
        db
          .select({
            storyId: storyThemes.storyId,
            themeId: sql<number>`${intoId}`.as("theme_id"),
            confidence: storyThemes.confidence,
            assignedAt: storyThemes.assignedAt,
            by: storyThemes.by,
          })
          .from(storyThemes)
          .where(eq(storyThemes.themeId, fromId)),
      )
      .onConflictDoNothing(),
    db.update(themes).set({ status: "merged", mergedInto: intoId }).where(eq(themes.id, fromId)),
    // Themes merged earlier into `fromId` point straight at the target, so no chains form.
    db.update(themes).set({ mergedInto: intoId }).where(eq(themes.mergedInto, fromId)),
    db
      .update(themes)
      .set({
        firstSeen: Math.min(from.firstSeen, into.firstSeen),
        lastSeen: Math.max(from.lastSeen, into.lastSeen),
        storyCount: storyCountSql,
      })
      .where(eq(themes.id, intoId)),
    recordThemeEvent(db, { themeId: fromId, kind: "merged", detailJson: { into: intoId, by } }),
    recordThemeEvent(db, { themeId: intoId, kind: "merged", detailJson: { from: fromId, by } }),
  ])
}

/** Status change plus one event per theme, chunked under the parameter limit. */
const setStatus = (db: Db, ids: number[], status: "active" | "closed", kind: "promoted" | "closed") =>
  runBatch(
    db,
    idChunks(ids).flatMap((chunk) => [
      db.update(themes).set({ status }).where(inArray(themes.id, chunk)),
      db.insert(themeEvents).values(chunk.map((themeId) => ({ themeId, kind }))),
    ]),
  )

/** Close live themes with no story since `before`, up to PAGE per call; returns their ids. */
export const closeQuietThemes = async (db: Db, before: number) => {
  const rows = await db
    .select({ id: themes.id })
    .from(themes)
    .where(and(inArray(themes.status, LIVE), lt(themes.lastSeen, before)))
    .limit(PAGE)
  const ids = rows.map((r) => r.id)
  await setStatus(db, ids, "closed", "closed")
  return ids
}

/**
 * Make provisional themes active once they have `minStories` stories or one unmerged story scoring at least
 * `minScore` (core's themeVisible, in SQL), up to PAGE per call; returns their ids.
 */
export const promoteProvisionalThemes = async (db: Db, o: { minStories: number; minScore: number }) => {
  const rows = await db
    .select({ id: themes.id })
    .from(themes)
    .where(
      and(
        eq(themes.status, "provisional"),
        or(
          gte(themes.storyCount, o.minStories),
          sql`exists (select 1 from ${storyThemes} inner join ${stories} on ${stories.id} = ${storyThemes.storyId}
            where ${storyThemes.themeId} = ${themes.id} and ${linked} and ${stories.status} != 'merged'
            and ${stories.score} >= ${o.minScore})`,
        ),
      ),
    )
    .limit(PAGE)
  const ids = rows.map((r) => r.id)
  await setStatus(db, ids, "active", "promoted")
  return ids
}

/** Recount `storyCount` from links to stories that were not merged away. */
export const refreshThemeCounts = (db: Db, themeIds: number[]) =>
  runBatch(
    db,
    idChunks(themeIds).map((ids) =>
      db.update(themes).set({ storyCount: storyCountSql }).where(inArray(themes.id, ids)),
    ),
  )

/** The explanation, with the momentum it was written at, for briefs.ts's themesToExplain. */
export const updateThemeExplanation = (db: Db, id: number, explanation: string, at: number) =>
  db
    .update(themes)
    .set({ explanation, explainedAt: at, explainedMomentum24h: sql`${themes.momentum24h}` })
    .where(eq(themes.id, id))
const HOUR = 3_600_000

/**
 * A story's theme links with their times, so the hourly step can pass over stories themed since their extraction.
 * Detached links (confidence 0) are included, so a story is never sent back to the theme it was detached from.
 */
export const storyThemeLinks = async (db: Db, storyIds: number[]) => {
  const pages = await runBatch(
    db,
    idChunks(storyIds).map((ids) =>
      db
        .select({
          storyId: storyThemes.storyId,
          themeId: storyThemes.themeId,
          confidence: storyThemes.confidence,
          assignedAt: storyThemes.assignedAt,
        })
        .from(storyThemes)
        .where(inArray(storyThemes.storyId, ids)),
    ),
  )
  return (pages as { storyId: number; themeId: number; confidence: number; assignedAt: number }[][]).flat()
}

/** Hour start of an article's publish time, as queries/rollups.ts buckets it. */
const articleBucket = sql<number>`(${articles.publishedAt} / 3600000) * 3600000`
const themeGroupWhere = (from: number, to: number, themeIds?: number[]) =>
  and(
    gte(articles.publishedAt, from),
    lt(articles.publishedAt, to),
    linked,
    themeIds ? inArray(storyThemes.themeId, themeIds) : undefined,
  )

/** Articles per hour bucket and theme in [from, to), through the stories linked to it. */
export const themeBucketGroups = (db: Db, from: number, to: number) =>
  db
    .select({
      bucket: articleBucket,
      themeId: storyThemes.themeId,
      articles: sql<number>`count(*)`,
      origins: sql<number>`sum(${articles.originId} is null)`,
    })
    .from(articles)
    .innerJoin(storyThemes, eq(storyThemes.storyId, articles.storyId))
    .where(themeGroupWhere(from, to))
    .groupBy(articleBucket, storyThemes.themeId)

/**
 * Recount these themes' rollups over the hours [from, to) in SQL, for links made after their articles' buckets left
 * the hourly recount. Same counts as themeBucketGroups; `from` and `to` must be hour starts.
 */
export const refreshThemeRollups = (db: Db, themeIds: number[], from: number, to: number, now: number) =>
  runBatch(
    db,
    idChunks(themeIds).map((ids) =>
      db
        .insert(rollups)
        .select(
          db
            .select({
              bucket: articleBucket.as("bucket"),
              kind: sql<"theme">`'theme'`.as("kind"),
              key: sql<string>`cast(${storyThemes.themeId} as text)`.as("key"),
              articles: sql<number>`count(*)`.as("articles"),
              origins: sql<number>`sum(${articles.originId} is null)`.as("origins"),
              newStories: sql<number>`0`.as("new_stories"),
              scoreSum: sql<number>`0`.as("score_sum"),
              scoreN: sql<number>`0`.as("score_n"),
              updatedAt: sql<number>`${now}`.as("updated_at"),
            })
            .from(articles)
            .innerJoin(storyThemes, eq(storyThemes.storyId, articles.storyId))
            .where(themeGroupWhere(from, to, ids))
            .groupBy(articleBucket, storyThemes.themeId),
        )
        .onConflictDoUpdate({
          target: [rollups.bucket, rollups.kind, rollups.key],
          set: {
            articles: sql`excluded.articles`,
            origins: sql`excluded.origins`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    ),
  )

/**
 * queries/rollups.ts's story momentum, over theme rollups: articles in the `hours` before `currentBucket` against the
 * `hours` before that. Null for a rise from 0, 0 for 0 to 0.
 */
export const themeMomentum = (currentBucket: number, hours: number) => {
  const split = currentBucket - hours * HOUR
  const recent = sql`total(case when ${rollups.bucket} >= ${split} then ${rollups.articles} end)`
  const previous = sql`total(case when ${rollups.bucket} < ${split} then ${rollups.articles} end)`
  return sql<number | null>`(select case when ${previous} = 0 then (case when ${recent} = 0 then 0 end)
    else round(100.0 * (${recent} - ${previous}) / ${previous}) end
    from ${rollups} where ${rollups.kind} = 'theme' and ${rollups.key} = cast(${themes.id} as text)
    and ${rollups.bucket} >= ${split - hours * HOUR} and ${rollups.bucket} < ${currentBucket})`
}

/** Momentum onto provisional and active themes; merged and closed ones keep their last value. */
export const writeThemeMomentum = async (db: Db, now: number, windows: { short: number; long: number }) => {
  const currentBucket = Math.floor(now / HOUR) * HOUR
  const updated = await db
    .update(themes)
    .set({
      momentum24h: themeMomentum(currentBucket, windows.short),
      momentum7d: themeMomentum(currentBucket, windows.long),
    })
    .where(inArray(themes.status, LIVE))
    .returning({ id: themes.id })
  return { momentumThemes: updated.length }
}
