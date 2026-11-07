import { and, desc, eq, getTableColumns, gt, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch, selectIn } from "../client.ts"
import {
  articles,
  deliveries,
  digests,
  type EditionMode,
  editionItemEvents,
  editionItems,
  editionJudgments,
  entities,
  eventArticles,
  eventEntities,
  events,
  eventThreads,
  stories,
  threads,
} from "../schema/index.ts"
import { lastRun, markRun } from "./entities.ts"

/** Rows grouped by their event, keeping their order. */
export const byEvent = <T extends { eventId: number }>(rows: T[]) => {
  const out = new Map<number, T[]>()
  for (const r of rows) {
    const list = out.get(r.eventId)
    if (list) list.push(r)
    else out.set(r.eventId, [r])
  }
  return out
}

/** Each event's unmerged threads with their live story, the highest confidence (its primary thread) first. */
export const eventThreadLinks = async (db: Db, ids: number[]) =>
  byEvent(
    await selectIn(db, ids, 2, (chunk) =>
      db
        .select({
          eventId: eventThreads.eventId,
          threadId: threads.id,
          name: threads.name,
          status: threads.status,
          storyId: stories.id,
          storyName: stories.name,
        })
        .from(eventThreads)
        .innerJoin(threads, eq(threads.id, eventThreads.threadId))
        .leftJoin(stories, and(eq(stories.id, threads.storyId), ne(stories.status, "merged")))
        .where(and(inArray(eventThreads.eventId, chunk), gt(eventThreads.confidence, 0), ne(threads.status, "merged")))
        .orderBy(desc(eventThreads.confidence), threads.id),
    ),
  )

/** Each event's entities, most mentioned first. */
export const eventEntityLinks = async (db: Db, ids: number[]) =>
  byEvent(
    await selectIn(db, ids, 2, (chunk) =>
      db
        .select({ eventId: eventEntities.eventId, entityId: entities.id, key: entities.key, name: entities.name })
        .from(eventEntities)
        .innerJoin(entities, eq(entities.id, eventEntities.entityId))
        .where(inArray(eventEntities.eventId, chunk))
        .orderBy(desc(eventEntities.mentions), entities.id),
    ),
  )

/**
 * Events with a member placed (`by` "placed") or fetched (`by` "fetched", for a replay) after `since` and at or
 * before `until`, counting only members fetched by `until`.
 */
export const changedEvents = async (db: Db, since: number, until: number, by: "placed" | "fetched") => {
  const at = by === "placed" ? eventArticles.at : articles.fetchedAt
  return (
    await db
      .selectDistinct({ id: eventArticles.eventId })
      .from(eventArticles)
      .innerJoin(articles, eq(articles.id, eventArticles.articleId))
      .where(and(gt(at, since), lte(at, until), lte(articles.fetchedAt, until)))
  ).map((r) => r.id)
}

/** When the latest sent edition started; null before the first. */
export const previousSentStart = async (db: Db) => {
  const [row] = await db
    .select({ at: sql<number | null>`max(${digests.startedAt})` })
    .from(digests)
    .where(eq(digests.status, "sent"))
  return row?.at ?? null
}

/** The stored digest copy per event, with the article set hash it was written from. */
export const eventCopyRows = async (db: Db, ids: number[]) =>
  new Map(
    (
      await selectIn(db, ids, 2, (chunk) =>
        db
          .select({
            id: events.id,
            headline: events.headline,
            summary: events.summary,
            copyHash: events.copyHash,
          })
          .from(events)
          .where(inArray(events.id, chunk)),
      )
    ).map((r) => [r.id, r]),
  )

const replayStep = "digest-v2-replay"

/** The latest `limit` replayed editions computed before `before`, newest first, empty ones included. */
const replayEditions = async (db: Db, before: number, limit: number) =>
  Object.entries((await lastRun(db, replayStep))?.detailJson ?? {})
    .flatMap(([key, asOf]) => (asOf < before ? [{ key, asOf }] : []))
    .sort((a, b) => b.asOf - a.asOf)
    .slice(0, limit)

/**
 * Records a replayed edition, whatever it picked, as hourly_runs step `digest-v2-replay`, whose detail maps edition
 * keys to their asOf. Editions after this one are dropped: a replay rerun rewrites them in order.
 */
export const markReplayEdition = async (db: Db, key: string, asOf: number) => {
  const earlier = (await replayEditions(db, asOf, 1)).filter((e) => e.key !== key)
  await markRun(
    db,
    replayStep,
    asOf,
    Object.fromEntries([...earlier.map((e) => [e.key, e.asOf] as const), [key, asOf]]),
  )
}

/** The latest replayed edition computed before `before`; null before the first. */
export const previousReplayAsOf = async (db: Db, before: number) =>
  (await replayEditions(db, before, 1))[0]?.asOf ?? null

/**
 * The given events already in an edition of this mode before `before`: carried by an item, or for "send" any
 * delivery of them.
 */
export const sentEvents = async (db: Db, mode: EditionMode, ids: number[], before: number) => {
  const [carried, delivered] = await Promise.all([
    selectIn(db, ids, 2, (chunk) =>
      db
        .selectDistinct({ id: editionItemEvents.eventId })
        .from(editionItemEvents)
        .innerJoin(editionItems, eq(editionItems.id, editionItemEvents.itemId))
        .where(
          and(eq(editionItems.mode, mode), lt(editionItems.asOf, before), inArray(editionItemEvents.eventId, chunk)),
        ),
    ),
    mode === "send"
      ? selectIn(db, ids, 1, (chunk) =>
          db.selectDistinct({ id: deliveries.eventId }).from(deliveries).where(inArray(deliveries.eventId, chunk)),
        )
      : [],
  ])
  return new Set([...carried, ...delivered].flatMap((r) => (r.id === null ? [] : [r.id])))
}

export type Brief = { storyId: number; headline: string; summary: string; at: number }

/**
 * Each story's latest item in this mode before `before`: what the reader was last told. For "send", digest
 * deliveries from before edition items count too, by their thread's story.
 */
export const lastBriefs = async (db: Db, mode: EditionMode, storyIds: number[], before: number) => {
  const [items, legacy] = await Promise.all([
    selectIn(db, storyIds, 2, (chunk) =>
      db
        .select({
          storyId: sql<number>`${editionItems.storyId}`,
          headline: editionItems.headline,
          summary: editionItems.summary,
          at: editionItems.asOf,
        })
        .from(editionItems)
        .where(and(eq(editionItems.mode, mode), lt(editionItems.asOf, before), inArray(editionItems.storyId, chunk))),
    ),
    mode === "send"
      ? selectIn(db, storyIds, 2, (chunk) =>
          db
            .select({
              storyId: sql<number>`${threads.storyId}`,
              headline: sql<string>`coalesce(${events.headline}, ${events.title})`,
              summary: sql<string>`coalesce(${events.summary}, ${events.gist})`,
              at: deliveries.sentAt,
            })
            .from(deliveries)
            .innerJoin(threads, eq(threads.id, deliveries.threadId))
            .innerJoin(events, eq(events.id, deliveries.eventId))
            .where(
              and(
                eq(deliveries.kind, "digest"),
                isNull(deliveries.editionItemId),
                lt(deliveries.sentAt, before),
                inArray(threads.storyId, chunk),
              ),
            ),
        )
      : [],
  ])
  const out = new Map<number, Brief>()
  for (const b of [...items, ...legacy]) {
    const seen = out.get(b.storyId)
    if (!seen || b.at > seen.at) out.set(b.storyId, b)
  }
  return out
}

/** A replay rerun replaces the edition's items and judgments. */
export const clearEdition = async (db: Db, key: string, mode: EditionMode) => {
  const ids = db
    .select({ id: editionItems.id })
    .from(editionItems)
    .where(and(eq(editionItems.editionKey, key), eq(editionItems.mode, mode)))
  await runBatch(db, [
    db.delete(editionItemEvents).where(inArray(editionItemEvents.itemId, ids)),
    db.delete(editionItems).where(and(eq(editionItems.editionKey, key), eq(editionItems.mode, mode))),
    db.delete(editionJudgments).where(and(eq(editionJudgments.editionKey, key), eq(editionJudgments.mode, mode))),
  ])
}

/** Saves the items in rank order with the events each carries; returns the item ids in the same order. */
export const saveEditionItems = async (db: Db, items: (typeof editionItems.$inferInsert & { events: number[] })[]) => {
  const inserted = (await runBatch(
    db,
    items.map(({ events: _, ...item }) => db.insert(editionItems).values(item).returning({ id: editionItems.id })),
  )) as { id: number }[][]
  const ids = inserted.map((r) => {
    const id = r[0]?.id
    if (id === undefined) throw new Error("edition item insert returned no row")
    return id
  })
  const links = items.flatMap((item, i) =>
    [...new Set(item.events)].map((eventId) => ({ itemId: ids[i] ?? 0, eventId })),
  )
  await runBatch(
    db,
    chunkRows(links, 2).map((chunk) => db.insert(editionItemEvents).values(chunk).onConflictDoNothing()),
  )
  return ids
}

export const saveJudgments = (db: Db, rows: (typeof editionJudgments.$inferInsert)[]) =>
  runBatch(
    db,
    chunkRows(rows, Object.keys(getTableColumns(editionJudgments)).length).map((chunk) =>
      db.insert(editionJudgments).values(chunk).onConflictDoNothing(),
    ),
  )
