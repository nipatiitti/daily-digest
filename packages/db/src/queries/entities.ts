import { and, eq, getTableColumns, gte, inArray, isNotNull, lt, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { articles, entities, hourlyRuns, llmCalls, rollups, stories, storyEntities } from "../schema/index.ts"

const HOUR = 3_600_000

/** ID lists of at most 50, leaving room for a statement's other parameters. */
const idChunks = <T>(ids: T[]) => chunkRows(ids, 2)

/**
 * Extracted stories whose latest extraction call was logged at or after `since`, oldest call first, with that call's
 * time. There is no evaluatedAt column, so this reads `llm_calls` through `llm_calls_purpose_at_idx`.
 */
export const storiesChangedSince = (db: Db, since: number, limit: number) => {
  const at = sql<number>`max(${llmCalls.at})`
  return db
    .select({ storyId: stories.id, at })
    .from(llmCalls)
    .innerJoin(stories, eq(stories.id, llmCalls.storyId))
    .where(and(eq(llmCalls.purpose, "extraction"), gte(llmCalls.at, since), isNotNull(stories.extractionHash)))
    .groupBy(stories.id)
    .orderBy(at)
    .limit(limit)
}

type StoryRow = { storyId: number; primaryEntity: string | null; firstSeen: number; lastArticleAt: number }
type ArticleRow = { storyId: number; entities: string[] | null; cves: string[] | null }

/**
 * Per story: its first-seen and last-article times, and the names to fold in order: the primary entity, the
 * articles' extracted entities, then their CVE IDs (also returned alone, as classification hints).
 */
export const storyEntityInputs = async (db: Db, storyIds: number[]) => {
  const chunks = idChunks(storyIds)
  const [storyRows, articleRows] = (await Promise.all([
    runBatch(
      db,
      chunks.map((ids) =>
        db
          .select({
            storyId: stories.id,
            primaryEntity: stories.primaryEntity,
            firstSeen: stories.firstSeen,
            lastArticleAt: stories.lastArticleAt,
          })
          .from(stories)
          .where(inArray(stories.id, ids)),
      ),
    ),
    // StoryEval writes one entity list to all of a story's articles, so distinct keeps this to a few rows per story.
    runBatch(
      db,
      chunks.map((ids) =>
        db
          .selectDistinct({ storyId: articles.storyId, entities: articles.entitiesJson, cves: articles.cveIdsJson })
          .from(articles)
          .where(inArray(articles.storyId, ids)),
      ),
    ),
  ])) as unknown as [StoryRow[][], ArticleRow[][]]
  const byStory = new Map<number, ArticleRow[]>()
  for (const a of articleRows.flat()) byStory.set(a.storyId, [...(byStory.get(a.storyId) ?? []), a])
  return storyRows.flat().map((s) => {
    const rows = byStory.get(s.storyId) ?? []
    const cves = [...new Set(rows.flatMap((a) => a.cves ?? []))]
    const names = [...(s.primaryEntity ? [s.primaryEntity] : []), ...rows.flatMap((a) => a.entities ?? []), ...cves]
    return { storyId: s.storyId, firstSeen: s.firstSeen, lastSeen: s.lastArticleAt, names, cves }
  })
}

/**
 * Insert new entities and widen the seen range of existing ones; name and kind stay as first written. Returns entity
 * IDs by key, following a manual merge to the entity it went into.
 */
export const upsertEntities = async (db: Db, rows: (typeof entities.$inferInsert)[]) => {
  if (rows.length === 0) return new Map<string, number>()
  const inserts = chunkRows(rows, Object.keys(getTableColumns(entities)).length).map((chunk) =>
    db
      .insert(entities)
      .values(chunk)
      .onConflictDoUpdate({
        target: entities.key,
        set: {
          firstSeen: sql`min(${entities.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`max(${entities.lastSeen}, excluded.last_seen)`,
        },
      }),
  )
  const selects = idChunks(rows.map((r) => r.key)).map((keys) =>
    db
      .select({ key: entities.key, id: sql<number>`coalesce(${entities.mergedInto}, ${entities.id})` })
      .from(entities)
      .where(inArray(entities.key, keys)),
  )
  const results = await runBatch(db, [...inserts, ...selects])
  const found = results.slice(inserts.length) as unknown as { key: string; id: number }[][]
  return new Map(found.flat().map((r) => [r.key, r.id]))
}

/** Insert links that do not exist yet; returns only the new ones. */
export const linkStoryEntities = async (db: Db, links: (typeof storyEntities.$inferInsert)[]) => {
  const results = await runBatch(
    db,
    chunkRows(links, Object.keys(getTableColumns(storyEntities)).length).map((chunk) =>
      db
        .insert(storyEntities)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ storyId: storyEntities.storyId, entityId: storyEntities.entityId }),
    ),
  )
  return (results as { storyId: number; entityId: number }[][]).flat()
}

/** Recount `storyCount` from links to stories that were not merged away. */
export const refreshEntityCounts = (db: Db, entityIds: number[]) =>
  runBatch(
    db,
    idChunks(entityIds).map((ids) =>
      db
        .update(entities)
        .set({
          storyCount: sql`(select count(*) from ${storyEntities} inner join ${stories}
            on ${stories.id} = ${storyEntities.storyId}
            where ${storyEntities.entityId} = ${entities.id} and ${stories.status} != 'merged')`,
        })
        .where(inArray(entities.id, ids)),
    ),
  )

export const entityByKey = async (db: Db, key: string) => {
  const [row] = await db.select().from(entities).where(eq(entities.key, key))
  return row ?? null
}

export const entityById = async (db: Db, id: number) => {
  const [row] = await db.select().from(entities).where(eq(entities.id, id))
  return row ?? null
}

/** Hour start of an article's publish time, as queries/rollups.ts buckets it. */
const articleBucket = sql<number>`(${articles.publishedAt} / 3600000) * 3600000`
const entityGroupWhere = (from: number, to: number, entityIds?: number[]) =>
  and(
    gte(articles.publishedAt, from),
    lt(articles.publishedAt, to),
    entityIds ? inArray(storyEntities.entityId, entityIds) : undefined,
  )

/** Articles per hour bucket and entity in [from, to), through the stories linked to it. */
export const entityBucketGroups = (db: Db, from: number, to: number) =>
  db
    .select({
      bucket: articleBucket,
      entityId: storyEntities.entityId,
      articles: sql<number>`count(*)`,
      origins: sql<number>`sum(${articles.originId} is null)`,
    })
    .from(articles)
    .innerJoin(storyEntities, eq(storyEntities.storyId, articles.storyId))
    .where(entityGroupWhere(from, to))
    .groupBy(articleBucket, storyEntities.entityId)

/**
 * Recount these entities' rollups over the hours [from, to) in SQL, for links made after their articles' buckets
 * left the hourly recount. Same counts as entityBucketGroups; `from` and `to` must be hour starts.
 */
export const refreshEntityRollups = (db: Db, entityIds: number[], from: number, to: number, now: number) =>
  runBatch(
    db,
    idChunks(entityIds).map((ids) =>
      db
        .insert(rollups)
        .select(
          db
            .select({
              bucket: articleBucket.as("bucket"),
              kind: sql<"entity">`'entity'`.as("kind"),
              key: sql<string>`cast(${storyEntities.entityId} as text)`.as("key"),
              articles: sql<number>`count(*)`.as("articles"),
              origins: sql<number>`sum(${articles.originId} is null)`.as("origins"),
              newStories: sql<number>`0`.as("new_stories"),
              scoreSum: sql<number>`0`.as("score_sum"),
              scoreN: sql<number>`0`.as("score_n"),
              updatedAt: sql<number>`${now}`.as("updated_at"),
            })
            .from(articles)
            .innerJoin(storyEntities, eq(storyEntities.storyId, articles.storyId))
            .where(entityGroupWhere(from, to, ids))
            .groupBy(articleBucket, storyEntities.entityId),
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

/** queries/rollups.ts's story momentum, over entity rollups: null for a rise from 0, 0 for 0 to 0. */
const entityMomentum = (currentBucket: number, hours: number) => {
  const split = currentBucket - hours * HOUR
  const recent = sql`total(case when ${rollups.bucket} >= ${split} then ${rollups.articles} end)`
  const previous = sql`total(case when ${rollups.bucket} < ${split} then ${rollups.articles} end)`
  return sql`(select case when ${previous} = 0 then (case when ${recent} = 0 then 0 end)
    else round(100.0 * (${recent} - ${previous}) / ${previous}) end
    from ${rollups} where ${rollups.kind} = 'entity' and ${rollups.key} = cast(${entities.id} as text)
    and ${rollups.bucket} >= ${split - hours * HOUR} and ${rollups.bucket} < ${currentBucket})`
}

/**
 * Momentum onto entities seen within both long windows, plus two hours so the last write after their final article
 * leaves both windows is 0 rather than -100. Older entities keep that 0.
 */
export const writeEntityMomentum = async (db: Db, now: number, windows: { short: number; long: number }) => {
  const currentBucket = Math.floor(now / HOUR) * HOUR
  const updated = await db
    .update(entities)
    .set({
      momentum24h: entityMomentum(currentBucket, windows.short),
      momentum7d: entityMomentum(currentBucket, windows.long),
    })
    .where(gte(entities.lastSeen, currentBucket - (2 * windows.long + 2) * HOUR))
    .returning({ id: entities.id })
  return { momentumEntities: updated.length }
}

export const lastRun = async (db: Db, step: string) => {
  const [row] = await db.select().from(hourlyRuns).where(eq(hourlyRuns.step, step))
  return row ?? null
}

export const markRun = (db: Db, step: string, at: number, detail: Record<string, number>) =>
  db
    .insert(hourlyRuns)
    .values({ step, lastRunAt: at, detailJson: detail })
    .onConflictDoUpdate({ target: hourlyRuns.step, set: { lastRunAt: at, detailJson: detail } })
