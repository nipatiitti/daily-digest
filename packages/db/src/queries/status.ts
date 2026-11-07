import { type AnyColumn, and, desc, eq, gte, isNull, ne, type SQL, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  articles,
  digests,
  editionItems,
  eventArticles,
  eventCodes,
  events,
  hourlyRuns,
  llmCalls,
  movers,
  pairDecisions,
  sources,
  threads,
} from "../schema/index.ts"

const HOUR = 3_600_000
const DAY = 24 * HOUR

const n = sql<number>`count(*)`
const countIf = (cond: SQL | undefined) => sql<number>`count(case when ${cond} then 1 end)`
const newest = (at: AnyColumn) => sql<number | null>`max(${at})`

/**
 * Everything the status page reads, in one batch, as of `now`: every source, disabled last and most failures first;
 * the ingest backlog and its oldest article; the hourly loop's newest writes; Claude spend per UTC day and purpose since
 * `spendFrom`; same-event decisions per hour and placements by how over the last `hours`; events first seen in the last
 * day and week and how many of them have one article; event and thread counts by status; the latest `editions` with
 * whether each was replayed.
 */
export const statusPage = async (db: Db, now: number, o: { spendFrom: number; hours: number; editions: number }) => {
  const since = now - o.hours * HOUR
  const day = sql<number>`(${llmCalls.at} / 86400000) * 86400000`
  const hour = sql<number>`(${pairDecisions.at} / 3600000) * 3600000`
  const lastDay = gte(events.firstSeen, now - DAY)
  const [
    list,
    [backlog],
    [placed],
    runs,
    [mover],
    [scored],
    spend,
    pairs,
    hows,
    [fresh],
    eventCounts,
    threadCounts,
    eds,
  ] = await db.batch([
    db
      .select({
        id: sources.id,
        name: sources.name,
        role: sources.role,
        country: sources.country,
        enabled: sources.enabled,
        lastStatus: sources.lastStatus,
        consecutiveFailures: sources.consecutiveFailures,
        items24h: sources.items24h,
        lastNewItemAt: sources.lastNewItemAt,
      })
      .from(sources)
      .orderBy(desc(sources.enabled), desc(sources.consecutiveFailures), sources.name),
    db
      .select({ n, oldest: sql<number | null>`min(${articles.fetchedAt})` })
      .from(articles)
      .leftJoin(eventArticles, eq(eventArticles.articleId, articles.id))
      .where(isNull(eventArticles.articleId)),
    db
      .select({ lastHour: countIf(gte(eventArticles.at, now - HOUR)), at: newest(eventArticles.at) })
      .from(eventArticles),
    db.select().from(hourlyRuns).orderBy(hourlyRuns.step),
    db.select({ at: newest(movers.bucket) }).from(movers),
    db.select({ at: newest(eventCodes.codedAt) }).from(eventCodes),
    db
      .select({ day, purpose: llmCalls.purpose, usd: sql<number>`sum(${llmCalls.estCostUsd})` })
      .from(llmCalls)
      .where(gte(llmCalls.at, o.spendFrom))
      .groupBy(day, llmCalls.purpose),
    db
      .select({ hour, merged: countIf(eq(pairDecisions.same, true)), rejected: countIf(eq(pairDecisions.same, false)) })
      .from(pairDecisions)
      .where(gte(pairDecisions.at, since))
      .groupBy(hour),
    db
      .select({ how: eventArticles.how, n })
      .from(eventArticles)
      .where(gte(eventArticles.at, since))
      .groupBy(eventArticles.how)
      .orderBy(desc(n)),
    db
      .select({
        day: countIf(lastDay),
        daySingles: countIf(and(lastDay, eq(events.articleCount, 1))),
        week: n,
        weekSingles: countIf(eq(events.articleCount, 1)),
      })
      .from(events)
      .where(and(ne(events.status, "merged"), gte(events.firstSeen, now - 7 * DAY))),
    db.select({ status: events.status, n }).from(events).groupBy(events.status),
    db.select({ status: threads.status, n }).from(threads).groupBy(threads.status),
    db
      .select({
        key: digests.digestDate,
        status: digests.status,
        sentAt: digests.sentAt,
        items: digests.itemCount,
        modes: sql<string | null>`(select group_concat(distinct ${editionItems.mode}) from ${editionItems}
            where ${editionItems.editionKey} = ${digests.digestDate} and ${editionItems.mode} != 'send')`,
      })
      .from(digests)
      .orderBy(desc(digests.digestDate))
      .limit(o.editions),
  ])
  return {
    sources: list,
    ingest: { backlog: backlog?.n ?? 0, oldest: backlog?.oldest ?? null, lastHour: placed?.lastHour ?? 0 },
    runs,
    lag: { movers: mover?.at ?? null, coding: scored?.at ?? null, placed: placed?.at ?? null },
    spend,
    pairs,
    hows,
    fresh,
    counts: { events: eventCounts, threads: threadCounts },
    editions: eds,
  }
}
