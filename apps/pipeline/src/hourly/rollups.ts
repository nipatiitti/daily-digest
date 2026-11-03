import { DAY_MS, FETCH, HOUR_MS, HOURLY, hourBucket } from "@digest/core"
import { type Db, deleteRollups, lastRun, markRun, oldestLateArticle, recountRollups } from "@digest/db"

const STEP = "rollups"

/**
 * Recount source, entity, thread and country buckets from the last HOURLY.recomputeBuckets hours, or further back to
 * the oldest article fetched, placed in an event or newly threaded since the last run (late items, the ingest
 * backlog, consolidation merges, missed crons). The first run drops v1's story-based entity rows and backfills the
 * article age window. One day per batch.
 */
export const rollupStep = async (db: Db, now: number) => {
  const to = hourBucket(now) + HOUR_MS
  const maxAgeMs = FETCH.maxItemAgeDays * DAY_MS
  const last = await lastRun(db, STEP)
  if (!last) await deleteRollups(db, "entity")
  const late = last ? await oldestLateArticle(db, last.lastRunAt - HOUR_MS, now, maxAgeMs) : now - maxAgeMs
  const start = Math.min(to - HOURLY.recomputeBuckets * HOUR_MS, hourBucket(late ?? now))
  let rows = 0
  for (let from = start; from < to; from += DAY_MS) {
    rows += await recountRollups(db, from, Math.min(from + DAY_MS, to), now)
  }
  const counts = { rows, fromHoursAgo: (to - start) / HOUR_MS, backfilled: last ? 0 : 1 }
  await markRun(db, STEP, now, counts)
  return counts
}
