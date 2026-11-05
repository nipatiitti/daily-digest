import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm"
import { type Db, selectIn } from "../client.ts"
import { articles, eventArticles, events, eventThreads, sources, threads } from "../schema/index.ts"
import { byEvent } from "./edition.ts"
import { SHOWN_THREADS } from "./reader.ts"

const askThread = {
  id: threads.id,
  name: threads.name,
  description: threads.description,
  momentum24h: threads.momentum24h,
  momentum7d: threads.momentum7d,
}

/**
 * Shown threads whose name or description holds any of `words`, the most words matched first, then the latest.
 * Each word binds two parameters, so keep `words` under 45.
 */
export const readAskThreads = async (db: Db, words: string[], limit: number) => {
  if (!words.length) return []
  const text = sql`(${threads.name} || ' ' || ${threads.description})`
  const likes = words.map((w) => sql`(${text} like ${`%${w}%`})`)
  return db
    .select(askThread)
    .from(threads)
    .where(and(inArray(threads.status, SHOWN_THREADS), or(...likes)))
    .orderBy(desc(sql.join(likes, sql` + `)), desc(threads.lastSeen))
    .limit(limit)
}

/** Shown threads by id, for the Ask prompt. */
export const readAskThreadsById = (db: Db, ids: number[]) =>
  selectIn(db, ids, 2, (chunk) =>
    db
      .select(askThread)
      .from(threads)
      .where(and(inArray(threads.id, chunk), inArray(threads.status, SHOWN_THREADS))),
  )

/** Each event's strongest shown thread, by event id. */
const primaryThreads = async (db: Db, eventIds: number[]) => {
  const rows = await selectIn(db, eventIds, 2, (chunk) =>
    db
      .select({ eventId: eventThreads.eventId, id: threads.id, name: threads.name })
      .from(eventThreads)
      .innerJoin(threads, eq(threads.id, eventThreads.threadId))
      .where(
        and(
          inArray(eventThreads.eventId, chunk),
          gt(eventThreads.confidence, 0),
          inArray(threads.status, SHOWN_THREADS),
        ),
      )
      .orderBy(desc(eventThreads.confidence), threads.id),
  )
  const out = new Map<number, { id: number; name: string }>()
  for (const r of rows) if (!out.has(r.eventId)) out.set(r.eventId, { id: r.id, name: r.name })
  return out
}

/** Unmerged events by id with what the Ask prompt reads, each with its strongest shown thread or null. */
export const readAskEvents = async (db: Db, ids: number[]) => {
  const [rows, linked] = await Promise.all([
    selectIn(db, ids, 2, (chunk) =>
      db
        .select({
          id: events.id,
          title: sql<string>`coalesce(${events.headline}, ${events.title})`,
          gist: events.gist,
          firstSeen: events.firstSeen,
          independentOrigins: events.independentOrigins,
          countries: events.countriesJson,
        })
        .from(events)
        .where(and(inArray(events.id, chunk), ne(events.status, "merged"))),
    ),
    primaryThreads(db, ids),
  ])
  return rows.map((e) => ({ ...e, thread: linked.get(e.id) ?? null }))
}

/**
 * The timeline under an answer: the events by id (a merged one as the event it went into), first seen first, each
 * with its strongest shown thread and up to `outlets` source names, independent origins first, then the earliest.
 */
export const readAskTimeline = async (db: Db, ids: number[], outlets: number) => {
  const roots = await selectIn(db, ids, 2, (chunk) =>
    db
      .select({ id: sql<number>`coalesce(${events.mergedInto}, ${events.id})` })
      .from(events)
      .where(inArray(events.id, chunk)),
  )
  const eventIds = [...new Set(roots.map((r) => r.id))]
  const [rows, linked, names] = await Promise.all([
    selectIn(db, eventIds, 2, (chunk) =>
      db
        .select({
          id: events.id,
          title: sql<string>`coalesce(${events.headline}, ${events.title})`,
          firstSeen: events.firstSeen,
          independentOrigins: events.independentOrigins,
        })
        .from(events)
        .where(and(inArray(events.id, chunk), ne(events.status, "merged"))),
    ),
    primaryThreads(db, eventIds),
    selectIn(db, eventIds, 2, (chunk) =>
      db
        .select({ eventId: eventArticles.eventId, name: sources.name })
        .from(eventArticles)
        .innerJoin(articles, eq(articles.id, eventArticles.articleId))
        .innerJoin(sources, eq(sources.id, articles.sourceId))
        .where(inArray(eventArticles.eventId, chunk))
        .groupBy(eventArticles.eventId, sources.id)
        .orderBy(desc(sql`max(${eventArticles.originArticleId} is null)`), sql`min(${articles.publishedAt})`),
    ),
  ])
  const outletsOf = byEvent(names)
  return rows
    .map((e) => ({
      ...e,
      thread: linked.get(e.id) ?? null,
      outlets: (outletsOf.get(e.id) ?? []).slice(0, outlets).map((o) => o.name),
    }))
    .sort((a, b) => a.firstSeen - b.firstSeen || a.id - b.id)
}

export type AskTimelineItem = Awaited<ReturnType<typeof readAskTimeline>>[number]
