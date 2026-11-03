import { and, desc, eq, gt, gte, inArray, lt, lte, ne, notExists, or, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { type Db, runBatch, selectIn } from "../client.ts"
import { entities, eventEntities, events, eventThreads, type Thread, threads } from "../schema/index.ts"

/** Threads a run may promote or close. */
const LIVE = ["provisional", "active"] as const

/** Rows read per statement: keeps D1 result sets small. */
const PAGE = 200

/** Live threads, and closed ones with an article since `closedSince`, which a joining event reopens. */
const joinable = (closedSince: number) =>
  or(inArray(threads.status, LIVE), and(eq(threads.status, "closed"), gte(threads.lastSeen, closedSince)))

/** Unmerged events linked to the thread in the current row, and their latest article. */
const memberEvents = (value: SQL) => sql`(select ${value} from ${eventThreads}
  inner join ${events} on ${events.id} = ${eventThreads.eventId}
  where ${eventThreads.threadId} = ${threads.id} and ${events.status} != 'merged')`
const eventCountSql = memberEvents(sql`count(*)`)
const lastSeenSql = sql`max(${threads.lastSeen}, coalesce(${memberEvents(sql`max(${events.lastArticleAt})`)}, 0))`

/**
 * One page of active events first seen after the cursor with no thread yet, oldest first, with what isSubstantial
 * reads. Pass the last row back as the cursor for the next page.
 */
export const unthreadedEvents = (db: Db, after: { firstSeen: number; id: number }) =>
  db
    .select({
      id: events.id,
      firstSeen: events.firstSeen,
      independentOrigins: events.independentOrigins,
      officialCount: events.officialCount,
    })
    .from(events)
    .where(
      and(
        eq(events.status, "active"),
        or(gt(events.firstSeen, after.firstSeen), and(eq(events.firstSeen, after.firstSeen), gt(events.id, after.id))),
        notExists(db.select({ one: sql`1` }).from(eventThreads).where(eq(eventThreads.eventId, events.id))),
      ),
    )
    .orderBy(events.firstSeen, events.id)
    .limit(PAGE)

/** The events with their centroid, countries and up to `perEvent` entity names (most mentioned first), oldest first. */
export const threadingEvents = async (db: Db, ids: number[], perEvent: number) => {
  const [rows, names] = await Promise.all([
    selectIn(db, ids, 2, (chunk) =>
      db
        .select({
          id: events.id,
          title: events.title,
          gist: events.gist,
          centroid: events.centroid,
          countries: events.countriesJson,
          firstSeen: events.firstSeen,
          lastArticleAt: events.lastArticleAt,
        })
        .from(events)
        .where(inArray(events.id, chunk)),
    ),
    selectIn(db, ids, 2, (chunk) => {
      const ranked = db
        .select({
          eventId: eventEntities.eventId,
          name: entities.name,
          rank: sql<number>`row_number() over (partition by ${eventEntities.eventId}
            order by ${eventEntities.mentions} desc, ${entities.id})`.as("rank"),
        })
        .from(eventEntities)
        .innerJoin(entities, eq(entities.id, eventEntities.entityId))
        .where(inArray(eventEntities.eventId, chunk))
        .as("ranked")
      return db
        .select({ eventId: ranked.eventId, name: ranked.name })
        .from(ranked)
        .where(lte(ranked.rank, perEvent))
        .orderBy(ranked.eventId, sql`${ranked.rank}`)
    }),
  ])
  const byEvent = new Map<number, string[]>()
  for (const n of names) byEvent.set(n.eventId, [...(byEvent.get(n.eventId) ?? []), n.name])
  return rows
    .map((e) => ({ ...e, entities: byEvent.get(e.id) ?? [] }))
    .sort((a, b) => a.firstSeen - b.firstSeen || a.id - b.id)
}

export type ThreadingEvent = Awaited<ReturnType<typeof threadingEvents>>[number]

/** Joinable threads whose events share at least `min` entities with this event, most shared first. */
export const threadsSharingEntities = (
  db: Db,
  eventId: number,
  o: { min: number; limit: number; closedSince: number },
) => {
  const other = alias(eventEntities, "other")
  const shared = sql<number>`count(distinct ${other.entityId})`
  return db
    .select({ id: eventThreads.threadId, shared })
    .from(eventEntities)
    .innerJoin(other, and(eq(other.entityId, eventEntities.entityId), ne(other.eventId, eventId)))
    .innerJoin(eventThreads, eq(eventThreads.eventId, other.eventId))
    .innerJoin(threads, eq(threads.id, eventThreads.threadId))
    .where(and(eq(eventEntities.eventId, eventId), joinable(o.closedSince)))
    .groupBy(eventThreads.threadId)
    .having(gte(shared, o.min))
    .orderBy(desc(shared))
    .limit(o.limit)
}

/** Every joinable thread with its centroid, read in pages of PAGE by id. */
export const joinableThreads = async (db: Db, closedSince: number) => {
  const out: Pick<Thread, "id" | "name" | "description" | "status" | "centroid" | "eventCount">[] = []
  for (let after = 0; ; ) {
    const page = await db
      .select({
        id: threads.id,
        name: threads.name,
        description: threads.description,
        status: threads.status,
        centroid: threads.centroid,
        eventCount: threads.eventCount,
      })
      .from(threads)
      .where(and(joinable(closedSince), gt(threads.id, after)))
      .orderBy(threads.id)
      .limit(PAGE)
    out.push(...page)
    const last = page.at(-1)
    if (page.length < PAGE || !last) return out
    after = last.id
  }
}

/** Up to `perThread` titles of each thread's latest unmerged events, by thread id. */
export const threadExamples = async (db: Db, threadIds: number[], perThread: number) => {
  const rows = await selectIn(db, threadIds, 2, (ids) => {
    const ranked = db
      .select({
        threadId: eventThreads.threadId,
        title: events.title,
        rank: sql<number>`row_number() over (partition by ${eventThreads.threadId}
          order by ${events.lastArticleAt} desc)`.as("rank"),
      })
      .from(eventThreads)
      .innerJoin(events, eq(events.id, eventThreads.eventId))
      .where(and(inArray(eventThreads.threadId, ids), ne(events.status, "merged")))
      .as("ranked")
    return db
      .select({ threadId: ranked.threadId, title: ranked.title })
      .from(ranked)
      .where(lte(ranked.rank, perThread))
      .orderBy(ranked.threadId, sql`${ranked.rank}`)
  })
  const out = new Map<number, string[]>()
  for (const r of rows) {
    out.set(r.threadId, [...(out.get(r.threadId) ?? []), r.title])
  }
  return out
}

type Link = { eventId: number; confidence: number; by: string; at: number }

/** A provisional thread founded by one event, and its link, in one batch. Returns the thread id. */
export const createThread = async (
  db: Db,
  t: Link & { name: string; description: string; centroid: Float32Array; firstSeen: number; lastSeen: number },
) => {
  // The batch is one transaction and ids autoincrement, so the newest id is the thread just inserted.
  const [[created]] = (await runBatch(db, [
    db
      .insert(threads)
      .values({
        name: t.name,
        description: t.description,
        centroid: t.centroid,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
        eventCount: 1,
      })
      .returning({ id: threads.id }),
    db.insert(eventThreads).values({
      eventId: t.eventId,
      threadId: sql<number>`(select max(${threads.id}) from ${threads})`,
      confidence: t.confidence,
      by: t.by,
      assignedAt: t.at,
    }),
  ])) as [{ id: number }[]]
  if (!created) throw new Error("Thread insert returned no row")
  return created.id
}

/**
 * Link an event to a thread with the thread's new centroid (the caller's running mean), recount its events, move
 * `lastSeen` and reopen it when closed.
 */
export const linkEventThread = (db: Db, l: Link & { threadId: number; centroid: Float32Array; lastSeen: number }) =>
  runBatch(db, [
    db
      .insert(eventThreads)
      .values({ eventId: l.eventId, threadId: l.threadId, confidence: l.confidence, by: l.by, assignedAt: l.at })
      .onConflictDoNothing(),
    db
      .update(threads)
      .set({
        centroid: l.centroid,
        eventCount: eventCountSql,
        lastSeen: sql`max(${threads.lastSeen}, ${l.lastSeen})`,
        status: sql`case when ${threads.status} = 'closed' then 'active' else ${threads.status} end`,
      })
      .where(eq(threads.id, l.threadId)),
  ])

/**
 * Recount live threads' events and latest article (consolidation moves links between events), then make provisional
 * threads with `visibleEvents` events active and close live ones quiet since `quietSince`. Returns the counts.
 */
export const threadLifecycle = async (db: Db, o: { visibleEvents: number; quietSince: number }) => {
  const [, promoted, closed] = (await runBatch(db, [
    db.update(threads).set({ eventCount: eventCountSql, lastSeen: lastSeenSql }).where(inArray(threads.status, LIVE)),
    db
      .update(threads)
      .set({ status: "active" })
      .where(and(eq(threads.status, "provisional"), gte(threads.eventCount, o.visibleEvents)))
      .returning({ id: threads.id }),
    db
      .update(threads)
      .set({ status: "closed" })
      .where(and(inArray(threads.status, LIVE), lt(threads.lastSeen, o.quietSince)))
      .returning({ id: threads.id }),
  ])) as [unknown, unknown[], unknown[]]
  return { promoted: promoted.length, closed: closed.length }
}
