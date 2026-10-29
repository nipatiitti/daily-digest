import { and, eq, getTableColumns, gt, gte, inArray, lt, or, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { articles, type Category, type RollupKind, rollups, sources, stories } from "../schema/index.ts"

const HOUR = 3_600_000

/** Hour start of an article's publish time; the literal keeps it integer division. */
const articleBucket = sql<number>`(${articles.publishedAt} / 3600000) * 3600000`
const articleCounts = {
  articles: sql<number>`count(*)`,
  origins: sql<number>`sum(${articles.originId} is null)`,
}
const publishedIn = (from: number, to: number) => and(gte(articles.publishedAt, from), lt(articles.publishedAt, to))

/**
 * Articles per hour bucket and story in [from, to), with the story's category (the source's for unassigned
 * articles), first-seen time and score. Unassigned articles group under a null story.
 */
export const storyBucketGroups = (db: Db, from: number, to: number) => {
  const category = sql<Category>`coalesce(${stories.category}, ${sources.category})`
  return db
    .select({
      bucket: articleBucket,
      storyId: articles.storyId,
      category,
      firstSeen: stories.firstSeen,
      score: stories.score,
      ...articleCounts,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(stories, eq(stories.id, articles.storyId))
    .where(publishedIn(from, to))
    .groupBy(articleBucket, articles.storyId, category)
}

/** Articles per hour bucket and source in [from, to). */
export const sourceBucketGroups = (db: Db, from: number, to: number) =>
  db
    .select({ bucket: articleBucket, sourceId: articles.sourceId, ...articleCounts })
    .from(articles)
    .where(publishedIn(from, to))
    .groupBy(articleBucket, articles.sourceId)

/**
 * Idempotent upsert on (bucket, kind, key). With `replace`, rows of those kinds in [from, to) are deleted first in
 * the same batch, so a key that lost its articles (a story merged or recategorised) drops out instead of going stale.
 */
export const upsertRollups = async (
  db: Db,
  rows: (typeof rollups.$inferInsert)[],
  replace?: { kinds: RollupKind[]; from: number; to: number },
) => {
  const clear = replace
    ? [
        db
          .delete(rollups)
          .where(
            and(
              inArray(rollups.kind, replace.kinds),
              gte(rollups.bucket, replace.from),
              lt(rollups.bucket, replace.to),
            ),
          ),
      ]
    : []
  const width = Object.keys(getTableColumns(rollups)).length
  await runBatch(db, [
    ...clear,
    ...chunkRows(rows, width).map((chunk) =>
      db
        .insert(rollups)
        .values(chunk)
        .onConflictDoUpdate({
          target: [rollups.bucket, rollups.kind, rollups.key],
          set: {
            articles: sql`excluded.articles`,
            origins: sql`excluded.origins`,
            newStories: sql`excluded.new_stories`,
            scoreSum: sql`excluded.score_sum`,
            scoreN: sql`excluded.score_n`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    ),
  ])
}

/**
 * Where the rollup recount should reach back to. `lastBucket` is the newest rollup bucket (null on an empty table).
 * `oldestLate` is the oldest publish time among articles fetched or embedded since the hour before `lastBucket` and
 * published within `maxAgeMs` (so a late article, a backlog or a requeue gets its old bucket recounted); on an empty
 * table it is the oldest article, for the backfill. Both reads are index-bounded.
 */
export const rollupStart = async (db: Db, now: number, maxAgeMs: number) => {
  const [r] = await db.select({ lastBucket: sql<number | null>`max(${rollups.bucket})` }).from(rollups)
  const lastBucket = r?.lastBucket ?? null
  const since = lastBucket === null ? null : lastBucket - HOUR
  const [a] = await db
    .select({ oldestLate: sql<number | null>`min(${articles.publishedAt})` })
    .from(articles)
    .where(
      since === null
        ? undefined
        : and(
            gte(articles.publishedAt, now - maxAgeMs),
            or(gte(articles.fetchedAt, since), gte(articles.embeddedAt, since)),
          ),
    )
  return { lastBucket, oldestLate: a?.oldestLate ?? null }
}

/** Rows for several keys of one kind in [from, to), ordered by key then bucket. Keep keys under ~95 (bound params). */
export const rollupBuckets = (db: Db, kind: RollupKind, keys: string[], from: number, to: number) =>
  keys.length === 0
    ? Promise.resolve([])
    : db
        .select()
        .from(rollups)
        .where(
          and(eq(rollups.kind, kind), inArray(rollups.key, keys), gte(rollups.bucket, from), lt(rollups.bucket, to)),
        )
        .orderBy(rollups.key, rollups.bucket)

/** One key's rows in [from, to), ordered by bucket. */
export const rollupSeries = (db: Db, kind: RollupKind, key: string, from: number, to: number) =>
  rollupBuckets(db, kind, [key], from, to)

/**
 * A story's momentum over `hours`: articles in the last `hours` complete buckets against the `hours` before.
 * Same rule as core's momentum(): null for a rise from 0, 0 for 0 to 0.
 */
const storyMomentum = (currentBucket: number, hours: number) => {
  const split = currentBucket - hours * HOUR
  const recent = sql`total(case when ${rollups.bucket} >= ${split} then ${rollups.articles} end)`
  const previous = sql`total(case when ${rollups.bucket} < ${split} then ${rollups.articles} end)`
  return sql`(select case when ${previous} = 0 then (case when ${recent} = 0 then 0 end)
    else round(100.0 * (${recent} - ${previous}) / ${previous}) end
    from ${rollups} where ${rollups.kind} = 'story' and ${rollups.key} = cast(${stories.id} as text)
    and ${rollups.bucket} >= ${split - hours * HOUR} and ${rollups.bucket} < ${currentBucket})`
}

/**
 * Write momentum onto active stories (from story rollups), origins in the velocity window onto stories with a recent
 * article or a stale nonzero count (from articles, since buckets are hourly; the process step keeps it fresh and this
 * decays it to 0), and items in the last 24 hours plus the current partial hour onto enabled sources (from source
 * rollups). Returns how many rows each statement touched.
 */
export const writeMomentum = async (
  db: Db,
  now: number,
  opts: { windows: { short: number; long: number }; velocityWindowMinutes: number },
) => {
  const currentBucket = Math.floor(now / HOUR) * HOUR
  const velocitySince = now - opts.velocityWindowMinutes * 60_000
  const results = await runBatch(db, [
    db
      .update(stories)
      .set({
        momentum24h: storyMomentum(currentBucket, opts.windows.short),
        momentum7d: storyMomentum(currentBucket, opts.windows.long),
      })
      .where(eq(stories.status, "active"))
      .returning({ id: stories.id }),
    db
      .update(stories)
      .set({
        origins30m: sql`(select count(*) from ${articles} where ${articles.storyId} = ${stories.id}
          and ${articles.originId} is null and ${articles.publishedAt} >= ${velocitySince})`,
      })
      .where(
        and(eq(stories.status, "active"), or(gte(stories.lastArticleAt, velocitySince), gt(stories.origins30m, 0))),
      )
      .returning({ id: stories.id }),
    db
      .update(sources)
      .set({
        items24h: sql`(select coalesce(sum(${rollups.articles}), 0) from ${rollups} where ${rollups.kind} = 'source'
          and ${rollups.key} = cast(${sources.id} as text) and ${rollups.bucket} >= ${currentBucket - 24 * HOUR})`,
      })
      .where(eq(sources.enabled, true))
      .returning({ id: sources.id }),
  ])
  const [momentumStories = 0, origins30mStories = 0, sourceCount = 0] = (results as unknown[][]).map((r) => r.length)
  return { momentumStories, origins30mStories, sources: sourceCount }
}
