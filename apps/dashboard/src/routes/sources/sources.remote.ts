import { DASHBOARD, LAMPS } from "@digest/core"
import { pollSourceNow, resetSourceBackoff, setSourceEnabled, sourceList } from "@digest/db"
import { z } from "zod"
import { byKeyBucket } from "#lib/components/format.ts"
import { attempt } from "#lib/forms.ts"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { form, query } from "$app/server"

type Lamp = "live" | "stale" | "off"
/** Off before stale before live, disabled sources last. */
const SEVERITY: Record<Lamp, number> = { off: 0, stale: 1, live: 2 }

/**
 * Every source with its lamp and articles per UTC day over the chart span, today last. The lamp ages the last
 * successful poll past the source's own interval against the header's fetch thresholds; a disabled source is off.
 */
export const sourceRows = query(async () => {
  const now = Date.now()
  const span = DASHBOARD.storyChartDays
  const to = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS
  const from = to - span * DAY_MS
  const { rows, days } = await sourceList(db(), from, to)
  const count = byKeyBucket(days)
  const spark = (id: number) => Array.from({ length: span }, (_, i) => count(id, from + i * DAY_MS))
  const lampOf = (s: (typeof rows)[number]): Lamp => {
    const late = s.lastOkAt === null ? null : (now - s.lastOkAt - s.pollSeconds * 1000) / 60_000
    if (!s.enabled || late === null || late >= LAMPS.fetchOffMinutes) return "off"
    return late >= LAMPS.fetchStaleMinutes ? "stale" : "live"
  }
  const list = rows
    .map((s) => ({ ...s, lamp: lampOf(s), spark: spark(s.id) }))
    .toSorted(
      (a, b) =>
        Number(!a.enabled) - Number(!b.enabled) || SEVERITY[a.lamp] - SEVERITY[b.lamp] || a.name.localeCompare(b.name),
    )
  return { now, rows: list }
})

export const sourceForm = form(
  z.object({ id: z.number().int().positive(), action: z.enum(["enable", "disable", "poll", "reset"]) }),
  async ({ id, action }) => {
    await attempt((by) =>
      action === "poll"
        ? pollSourceNow(db(), id, by)
        : action === "reset"
          ? resetSourceBackoff(db(), id, by)
          : setSourceEnabled(db(), id, action === "enable", by),
    )
    await sourceRows().refresh()
  },
)
