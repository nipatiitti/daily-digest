import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
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

/**
 * Claim due sources by pushing their next poll one interval ahead, so the next tick
 * doesn't enqueue them again while a fetch is in flight. Returns the claimed IDs.
 */
export const claimDueSources = (db: Db, now: number, limit = 100) =>
  db
    .update(sources)
    .set({ nextPollAt: sql`${now} + ${sources.pollSeconds} * 1000` })
    .where(
      inArray(
        sources.id,
        db
          .select({ id: sources.id })
          .from(sources)
          .where(and(eq(sources.enabled, true), lte(sources.nextPollAt, now)))
          .orderBy(asc(sources.nextPollAt))
          .limit(limit),
      ),
    )
    .returning({ id: sources.id })

export const getSource = (db: Db, id: number) => db.query.sources.findFirst({ where: eq(sources.id, id) })

/** status 0 means the request or the parse failed before an HTTP status applied. */
export type PollResult = {
  status: number
  etag?: string | null
  lastModified?: string | null
  newItems: number
}

/** Failed sources back off by doubling their interval per failure, up to this. */
const MAX_BACKOFF_MS = 24 * 3_600_000

/**
 * Record a fetch outcome and schedule the next poll. A success polls again after the
 * source's interval; a failure doubles the interval per consecutive failure (capped), so a
 * dead 3-minute feed settles at one request a day instead of 480.
 */
export const recordPoll = (db: Db, id: number, now: number, r: PollResult) => {
  const ok = r.status > 0 && r.status < 400
  const nextPollAt = ok
    ? sql`${now} + ${sources.pollSeconds} * 1000`
    : sql`${now} + min(${sources.pollSeconds} * 1000 * (1 << min(${sources.consecutiveFailures} + 1, 20)), ${MAX_BACKOFF_MS})`
  return db
    .update(sources)
    .set({
      lastStatus: r.status,
      nextPollAt,
      consecutiveFailures: ok ? 0 : sql`${sources.consecutiveFailures} + 1`,
      ...(ok && r.etag !== undefined ? { etag: r.etag } : {}),
      ...(ok && r.lastModified !== undefined ? { lastModified: r.lastModified } : {}),
      ...(r.newItems > 0 ? { lastNewItemAt: now } : {}),
    })
    .where(eq(sources.id, id))
}
