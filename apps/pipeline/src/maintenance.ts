import { MAINTENANCE } from "@digest/core"
import {
  closeQuietEvents,
  closeQuietStories,
  type Db,
  databaseSize,
  recordDbStats,
  rowCounts,
  staleSources,
  unassignedArticleCount,
  unassignedRecentArticles,
} from "@digest/db"
import type { llmFor } from "./llm.ts"
import type { ProcessMessage } from "./process.ts"
import { reactionsStep } from "./reactions.ts"

const DAY = 86_400_000

/**
 * Nightly: close quiet stories and events, requeue recent unassigned articles, record size and row counts, name stale
 * sources, then turn the week's votes into profile proposals.
 */
export const runMaintenance = async (
  db: Db,
  llm: ReturnType<typeof llmFor>,
  processQueue: Queue<ProcessMessage>,
  now: number,
) => {
  const closed = await closeQuietStories(db, now - MAINTENANCE.closeStoryAfterDays * DAY)
  const closedEvents = await closeQuietEvents(db, now - MAINTENANCE.closeStoryAfterDays * DAY)
  const requeue = await unassignedRecentArticles(
    db,
    now - MAINTENANCE.requeueWindowDays * DAY,
    MAINTENANCE.requeueLimit,
  )
  for (let i = 0; i < requeue.length; i += 100) {
    await processQueue.sendBatch(requeue.slice(i, i + 100).map(({ id }) => ({ body: { articleId: id } })))
  }
  const [sizeBytes, rows, unassigned, stale] = await Promise.all([
    databaseSize(db),
    rowCounts(db),
    unassignedArticleCount(db),
    staleSources(db, now),
  ])
  await recordDbStats(db, { day: new Date(now).toISOString().slice(0, 10), sizeBytes, rowsJson: rows })
  const warn = MAINTENANCE.dbWarnBytes.filter((b) => sizeBytes >= b)
  console.log(
    JSON.stringify({
      event: "maintenance",
      closedStories: closed.length,
      closedEvents,
      requeuedArticles: requeue.length,
      sizeBytes,
      sizeWarning: warn.length > 0 ? `over ${warn[warn.length - 1]} bytes` : null,
      unassignedArticles: unassigned,
      staleSources: stale.map((s) => s.slug),
      rows,
    }),
  )
  try {
    console.log(JSON.stringify({ event: "reactions", ...(await reactionsStep(db, llm, now)) }))
  } catch (e) {
    console.error(JSON.stringify({ event: "reactions_failed", error: String(e) }))
  }
}
