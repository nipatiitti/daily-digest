import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import {
  articles,
  entities,
  eventArticles,
  events,
  MOVER_KINDS,
  type MoverKind,
  movers,
  rollups,
  threads,
} from "../schema/index.ts"
import { subjectEvents } from "./reader.ts"

const HOUR = 3_600_000

/**
 * Articles per thread, entity and country over the `short` and `long` complete hours before `bucket`, and over the
 * same spans before those, for subjects with at least `minArticles` in the short window. Threads must be active and
 * entities unmerged; `name` is null for a country and `entityKey` lets the caller drop outlets.
 */
export const moverTotals = (db: Db, bucket: number, o: { short: number; long: number; minArticles: number }) => {
  const sum = (hoursAgo: number, span: number) =>
    sql<number>`total(case when ${rollups.bucket} >= ${bucket - hoursAgo * HOUR}
      and ${rollups.bucket} < ${bucket - (hoursAgo - span) * HOUR} then ${rollups.articles} end)`
  const recentShort = sum(o.short, o.short)
  const totals = db
    .select({
      kind: rollups.kind,
      key: rollups.key,
      recentShort: recentShort.as("recent_short"),
      previousShort: sum(2 * o.short, o.short).as("previous_short"),
      recentLong: sum(o.long, o.long).as("recent_long"),
      previousLong: sum(2 * o.long, o.long).as("previous_long"),
    })
    .from(rollups)
    .where(
      and(
        inArray(rollups.kind, MOVER_KINDS),
        gte(rollups.bucket, bucket - 2 * Math.max(o.short, o.long) * HOUR),
        lt(rollups.bucket, bucket),
      ),
    )
    .groupBy(rollups.kind, rollups.key)
    .having(gte(recentShort, o.minArticles))
    .as("totals")
  return db
    .select({
      kind: sql<MoverKind>`${totals.kind}`,
      key: totals.key,
      recentShort: totals.recentShort,
      previousShort: totals.previousShort,
      recentLong: totals.recentLong,
      previousLong: totals.previousLong,
      name: sql<string | null>`coalesce(${threads.name}, ${entities.name})`,
      entityKey: entities.key,
    })
    .from(totals)
    .leftJoin(
      threads,
      and(eq(totals.kind, "thread"), eq(threads.id, sql`cast(${totals.key} as integer)`), eq(threads.status, "active")),
    )
    .leftJoin(
      entities,
      and(eq(totals.kind, "entity"), eq(entities.id, sql`cast(${totals.key} as integer)`), isNull(entities.mergedInto)),
    )
    .where(or(eq(totals.kind, "country"), isNotNull(threads.id), isNotNull(entities.id)))
}

/**
 * Per mover, the titles (digest headline, else the event title) of the events with the most articles published in
 * [from, to), at most `limit` each, in the movers' order.
 */
export const moverEventTitles = async (
  db: Db,
  subjects: { kind: MoverKind; key: string }[],
  o: { from: number; to: number; limit: number },
) => {
  const pages = await runBatch(
    db,
    subjects.map((s) =>
      db
        .select({ title: sql<string>`coalesce(${events.headline}, ${events.title})` })
        .from(eventArticles)
        .innerJoin(articles, eq(articles.id, eventArticles.articleId))
        .innerJoin(events, eq(events.id, eventArticles.eventId))
        .where(and(gte(articles.publishedAt, o.from), lt(articles.publishedAt, o.to), subjectEvents(s.kind, s.key)))
        .groupBy(events.id)
        .orderBy(desc(sql`count(*)`))
        .limit(o.limit),
    ),
  )
  return (pages as { title: string }[][]).map((rows) => rows.map((r) => r.title))
}

/** Replace the hour's movers and delete rows from before `keepSince`, in one batch. */
export const replaceMovers = (db: Db, bucket: number, rows: (typeof movers.$inferInsert)[], keepSince: number) =>
  runBatch(db, [
    db.delete(movers).where(or(eq(movers.bucket, bucket), lt(movers.bucket, keepSince))),
    ...chunkRows(rows, Object.keys(getTableColumns(movers)).length).map((chunk) => db.insert(movers).values(chunk)),
  ])
