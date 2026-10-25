import { and, asc, eq, lte, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { sources } from "../schema/index.ts"

/** Enabled sources whose next poll is due. */
export const dueSources = (db: Db, now: number, limit = 100) =>
  db
    .select()
    .from(sources)
    .where(and(eq(sources.enabled, true), lte(sources.nextPollAt, now)))
    .orderBy(asc(sources.nextPollAt))
    .limit(limit)

export type PollResult = {
  status: number
  etag?: string | null
  lastModified?: string | null
  newItems: number
}

/** Record a fetch outcome and schedule the next poll from the source's interval. */
export const recordPoll = (db: Db, id: number, now: number, r: PollResult) => {
  const ok = r.status < 400
  return db
    .update(sources)
    .set({
      lastStatus: r.status,
      nextPollAt: sql`${now} + ${sources.pollSeconds} * 1000`,
      consecutiveFailures: ok ? 0 : sql`${sources.consecutiveFailures} + 1`,
      ...(ok && r.etag !== undefined ? { etag: r.etag } : {}),
      ...(ok && r.lastModified !== undefined ? { lastModified: r.lastModified } : {}),
      ...(r.newItems > 0 ? { lastNewItemAt: now } : {}),
    })
    .where(eq(sources.id, id))
}
