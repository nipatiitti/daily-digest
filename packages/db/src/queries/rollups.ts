import { and, eq, gte, inArray, lt, or, type SQL, sql } from "drizzle-orm"
import type { SQLiteColumn, SQLiteInsertSelectQueryBuilder } from "drizzle-orm/sqlite-core"
import { type Db, runBatch } from "../client.ts"
import {
  articleFacets,
  articles,
  entities,
  eventArticles,
  eventEntities,
  events,
  eventThreads,
  type RollupKind,
  rollups,
  sources,
  threads,
} from "../schema/index.ts"

const HOUR = 3_600_000

/** The kinds v2 writes; the other ROLLUP_KINDS are v1 rows left until the drop migration. */
const V2_KINDS = ["source", "entity", "thread", "country"] as const

/** Hour start of an article's publish time; the literal keeps it integer division. */
const articleBucket = sql<number>`(${articles.publishedAt} / 3600000) * 3600000`

/**
 * A rollup row in table column order, for insert ... select: articles, origins (members that are not a wire copy of
 * another) and new events (first seen in the bucket), each counted once however the joins fan out.
 */
const rollupRow = (kind: RollupKind, key: SQL | SQLiteColumn, now: number) => ({
  bucket: articleBucket.as("bucket"),
  kind: sql<RollupKind>`${kind}`.as("kind"),
  key: sql<string>`cast(${key} as text)`.as("key"),
  articles: sql<number>`count(distinct ${articles.id})`.as("articles"),
  origins: sql<number>`count(distinct case when ${eventArticles.articleId} is not null
    and ${eventArticles.originArticleId} is null then ${articles.id} end)`.as("origins"),
  newStories: sql<number>`count(distinct case when (${events.firstSeen} / 3600000) * 3600000 = ${articleBucket}
    then ${events.id} end)`.as("new_stories"),
  scoreSum: sql<number>`0`.as("score_sum"),
  scoreN: sql<number>`0`.as("score_n"),
  updatedAt: sql<number>`${now}`.as("updated_at"),
})

/**
 * Recount the v2 kinds over the hours [from, to), which must be hour starts: articles per source, per entity and
 * thread through their events, and per country through the facets. Rows of those kinds in the range are replaced, so
 * a key that lost its articles drops out. Returns the rows written.
 */
export const recountRollups = async (db: Db, from: number, to: number, now: number) => {
  const published = and(gte(articles.publishedAt, from), lt(articles.publishedAt, to))
  const country = sql`c.value`
  const insert = (q: SQLiteInsertSelectQueryBuilder<typeof rollups>) =>
    db.insert(rollups).select(q).returning({ key: rollups.key })
  // Entity and thread rows count placed articles only; source and country rows also count those not yet placed.
  const placed = (kind: RollupKind, key: SQLiteColumn) =>
    db
      .select(rollupRow(kind, key, now))
      .from(articles)
      .innerJoin(eventArticles, eq(eventArticles.articleId, articles.id))
      .innerJoin(events, eq(events.id, eventArticles.eventId))
  const results = await runBatch(db, [
    db.delete(rollups).where(and(inArray(rollups.kind, V2_KINDS), gte(rollups.bucket, from), lt(rollups.bucket, to))),
    insert(
      db
        .select(rollupRow("source", articles.sourceId, now))
        .from(articles)
        .leftJoin(eventArticles, eq(eventArticles.articleId, articles.id))
        .leftJoin(events, eq(events.id, eventArticles.eventId))
        .where(published)
        .groupBy(articleBucket, articles.sourceId),
    ),
    insert(
      placed("entity", eventEntities.entityId)
        .innerJoin(eventEntities, eq(eventEntities.eventId, eventArticles.eventId))
        .where(published)
        .groupBy(articleBucket, eventEntities.entityId),
    ),
    insert(
      placed("thread", eventThreads.threadId)
        .innerJoin(eventThreads, eq(eventThreads.eventId, eventArticles.eventId))
        .where(published)
        .groupBy(articleBucket, eventThreads.threadId),
    ),
    insert(
      db
        .select(rollupRow("country", country, now))
        .from(articles)
        .innerJoin(articleFacets, eq(articleFacets.articleId, articles.id))
        .innerJoin(sql`json_each(${articleFacets.countriesJson}) as c`, sql`1`)
        .leftJoin(eventArticles, eq(eventArticles.articleId, articles.id))
        .leftJoin(events, eq(events.id, eventArticles.eventId))
        .where(published)
        .groupBy(articleBucket, country),
    ),
  ])
  return (results.slice(1) as unknown[][]).reduce((n, rows) => n + rows.length, 0)
}

/** Drop every row of one kind, for a recount that replaces how the kind is counted. */
export const deleteRollups = (db: Db, kind: RollupKind) => db.delete(rollups).where(eq(rollups.kind, kind))

/**
 * The oldest publish time, within `maxAgeMs` of `now`, of articles fetched or placed in an event since `since`, or
 * whose event joined a thread or absorbed a merged event since then, so the recount reaches their buckets. Null when
 * there is none. Bounded by the articles published in the age window.
 */
export const oldestLateArticle = async (db: Db, since: number, now: number, maxAgeMs: number) => {
  const [r] = await db
    .select({ at: sql<number | null>`min(${articles.publishedAt})` })
    .from(articles)
    .leftJoin(eventArticles, eq(eventArticles.articleId, articles.id))
    .where(
      and(
        gte(articles.publishedAt, now - maxAgeMs),
        or(
          gte(articles.fetchedAt, since),
          gte(eventArticles.at, since),
          sql`exists (select 1 from ${eventThreads} where ${eventThreads.eventId} = ${eventArticles.eventId}
            and ${eventThreads.assignedAt} >= ${since})`,
          sql`exists (select 1 from ${events} where ${events.mergedInto} = ${eventArticles.eventId}
            and ${events.updatedAt} >= ${since})`,
        ),
      ),
    )
  return r?.at ?? null
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

/**
 * Momentum over `hours` from the rollups of the subject in the current row: articles in the last `hours` complete
 * buckets against the `hours` before. Same rule as core's momentum(): null for a rise from 0, 0 for 0 to 0.
 */
const momentumSql = (kind: "thread" | "entity", id: SQLiteColumn, currentBucket: number, hours: number) => {
  const split = currentBucket - hours * HOUR
  const recent = sql`total(case when ${rollups.bucket} >= ${split} then ${rollups.articles} end)`
  const previous = sql`total(case when ${rollups.bucket} < ${split} then ${rollups.articles} end)`
  return sql<number | null>`(select case when ${previous} = 0 then (case when ${recent} = 0 then 0 end)
    else round(100.0 * (${recent} - ${previous}) / ${previous}) end
    from ${rollups} where ${rollups.kind} = ${kind} and ${rollups.key} = cast(${id} as text)
    and ${rollups.bucket} >= ${split - hours * HOUR} and ${rollups.bucket} < ${currentBucket})`
}

/**
 * Momentum onto provisional and active threads (merged and closed ones keep their last value) and onto entities seen
 * within both long windows plus two hours, so the last write after their final article leaves both windows is 0
 * rather than -100; items in the last 24 hours plus the current partial hour onto enabled sources. Returns how many
 * rows each statement touched.
 */
export const writeMomentum = async (db: Db, now: number, windows: { short: number; long: number }) => {
  const currentBucket = Math.floor(now / HOUR) * HOUR
  const both = (kind: "thread" | "entity", id: SQLiteColumn) => ({
    momentum24h: momentumSql(kind, id, currentBucket, windows.short),
    momentum7d: momentumSql(kind, id, currentBucket, windows.long),
  })
  const results = await runBatch(db, [
    db
      .update(threads)
      .set(both("thread", threads.id))
      .where(inArray(threads.status, ["provisional", "active"]))
      .returning({ id: threads.id }),
    db
      .update(entities)
      .set(both("entity", entities.id))
      .where(gte(entities.lastSeen, currentBucket - (2 * windows.long + 2) * HOUR))
      .returning({ id: entities.id }),
    db
      .update(sources)
      .set({
        items24h: sql`(select coalesce(sum(${rollups.articles}), 0) from ${rollups} where ${rollups.kind} = 'source'
          and ${rollups.key} = cast(${sources.id} as text) and ${rollups.bucket} >= ${currentBucket - 24 * HOUR})`,
      })
      .where(eq(sources.enabled, true))
      .returning({ id: sources.id }),
  ])
  const [momentumThreads = 0, momentumEntities = 0, sourceCount = 0] = (results as unknown[][]).map((r) => r.length)
  return { momentumThreads, momentumEntities, sources: sourceCount }
}
