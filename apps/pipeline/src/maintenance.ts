import { MAINTENANCE } from "@digest/core"
import {
  closeQuietStories,
  type Db,
  databaseSize,
  recordDbStats,
  rowCounts,
  staleSources,
  unassignedArticleCount,
} from "@digest/db"

const DAY = 86_400_000

/** Nightly: close quiet stories, record database size and row counts, name stale sources. */
export const runMaintenance = async (db: Db, now: number) => {
  const closed = await closeQuietStories(db, now - MAINTENANCE.closeStoryAfterDays * DAY)
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
      sizeBytes,
      sizeWarning: warn.length > 0 ? `over ${warn[warn.length - 1]} bytes` : null,
      unassignedArticles: unassigned,
      staleSources: stale.map((s) => s.slug),
      rows,
    }),
  )
}
