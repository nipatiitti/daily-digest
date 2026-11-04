import { MAINTENANCE } from "@digest/core"
import { closeQuietEvents, type Db, databaseSize, recordDbStats, rowCounts, staleSources } from "@digest/db"
import type { llmFor } from "./llm.ts"
import { reactionsStep } from "./reactions.ts"

const DAY = 86_400_000

/** Nightly: close quiet events, record size and row counts, name stale sources, then turn the week's votes into profile proposals. */
export const runMaintenance = async (db: Db, llm: ReturnType<typeof llmFor>, now: number) => {
  const closedEvents = await closeQuietEvents(db, now - MAINTENANCE.closeEventAfterDays * DAY)
  const [sizeBytes, rows, stale] = await Promise.all([databaseSize(db), rowCounts(db), staleSources(db, now)])
  await recordDbStats(db, { day: new Date(now).toISOString().slice(0, 10), sizeBytes, rowsJson: rows })
  const warn = MAINTENANCE.dbWarnBytes.filter((b) => sizeBytes >= b)
  console.log(
    JSON.stringify({
      event: "maintenance",
      closedEvents,
      sizeBytes,
      sizeWarning: warn.length > 0 ? `over ${warn[warn.length - 1]} bytes` : null,
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
