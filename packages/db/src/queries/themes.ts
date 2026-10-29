import { and, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { stories, storyEntities, storyThemes, type Theme, themeEvents, themes } from "../schema/index.ts"

/** Themes a story can join or a run may close. */
const LIVE = ["provisional", "active"] as const

/** Rows read or written per statement: keeps D1 result sets small and ID lists under the parameter limit. */
const PAGE = 200

/** ID lists of at most 50, leaving room for a statement's other parameters. */
const idChunks = <T>(ids: T[]) => chunkRows(ids, 2)

/** Unmerged stories linked to the theme in the current row, for `storyCount`. */
const storyCountSql = sql<number>`(select count(*) from ${storyThemes} inner join ${stories}
  on ${stories.id} = ${storyThemes.storyId}
  where ${storyThemes.themeId} = ${themes.id} and ${stories.status} != 'merged')`

/** The insert for one event, to put in a caller's batch. */
export const recordThemeEvent = (db: Db, event: typeof themeEvents.$inferInsert) => db.insert(themeEvents).values(event)

export const themeById = async (db: Db, id: number) => {
  const [row] = await db.select().from(themes).where(eq(themes.id, id))
  return row ?? null
}

/**
 * Live themes whose stories share at least `min` entities with this story, most shared first. Bounded by the story's
 * own links (at most ENTITIES.maxPerStory) and `limit`.
 */
export const candidateThemesByEntities = (db: Db, storyId: number, min: number, limit: number) => {
  const other = alias(storyEntities, "other")
  const shared = sql<number>`count(distinct ${other.entityId})`
  return db
    .select({ id: storyThemes.themeId, shared })
    .from(storyEntities)
    .innerJoin(other, and(eq(other.entityId, storyEntities.entityId), ne(other.storyId, storyId)))
    .innerJoin(storyThemes, eq(storyThemes.storyId, other.storyId))
    .innerJoin(themes, eq(themes.id, storyThemes.themeId))
    .where(and(eq(storyEntities.storyId, storyId), inArray(themes.status, LIVE)))
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
        .where(and(inArray(storyThemes.themeId, ids), ne(stories.status, "merged")))
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

/** A provisional theme founded by one story, its link and a `created` event. Returns the theme id. */
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
  const [created] = await db
    .insert(themes)
    .values({
      name: t.name,
      description: t.description,
      embedding: t.embedding,
      firstSeen: t.firstSeen,
      lastSeen: t.firstSeen,
      storyCount: 1,
    })
    .returning({ id: themes.id })
  if (!created) throw new Error("Theme insert returned no row")
  await runBatch(db, [
    db.insert(storyThemes).values({ storyId: t.storyId, themeId: created.id, confidence: t.confidence, by: t.by }),
    recordThemeEvent(db, { themeId: created.id, kind: "created", detailJson: { storyId: t.storyId, by: t.by } }),
  ])
  return created.id
}

/** Link a story to a theme if it is not yet, move `lastSeen` and recount; a closed theme reopens as active. */
export const assignStoryTheme = async (
  db: Db,
  a: { storyId: number; themeId: number; confidence: number; by: string; at: number },
) => {
  const theme = await themeById(db, a.themeId)
  if (!theme) throw new Error(`No theme ${a.themeId}`)
  if (theme.status === "merged") throw new Error(`Theme ${a.themeId} was merged into ${theme.mergedInto}`)
  const reopen = theme.status === "closed"
  await runBatch(db, [
    db
      .insert(storyThemes)
      .values({ storyId: a.storyId, themeId: a.themeId, confidence: a.confidence, assignedAt: a.at, by: a.by })
      .onConflictDoNothing(),
    db
      .update(themes)
      .set({
        lastSeen: sql`max(${themes.lastSeen}, ${a.at})`,
        storyCount: storyCountSql,
        ...(reopen ? { status: "active" as const } : {}),
      })
      .where(eq(themes.id, a.themeId)),
    ...(reopen
      ? [recordThemeEvent(db, { themeId: a.themeId, kind: "reopened", detailJson: { storyId: a.storyId, by: a.by } })]
      : []),
  ])
  return { reopened: reopen }
}

/**
 * Merge `fromId` into `intoId`: its links are copied to the target (the old rows stay, for the audit trail), it is
 * marked merged, both get a `merged` event, and the target's seen range and count are refreshed.
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
            where ${storyThemes.themeId} = ${themes.id} and ${stories.status} != 'merged'
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

export const updateThemeExplanation = (db: Db, id: number, explanation: string, at: number) =>
  db.update(themes).set({ explanation, explainedAt: at }).where(eq(themes.id, id))
