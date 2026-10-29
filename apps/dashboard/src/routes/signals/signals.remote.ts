import { bucketsBetween, DASHBOARD, HOUR_MS, hourBucket, momentum } from "@digest/core"
import { CATEGORIES, type Db, risingThemes, rollupBuckets, THEME_STATUSES, themeList, themeStreams } from "@digest/db"
import { z } from "zod"
import { byKeyBucket } from "#lib/components/format.ts"
import { RANGES, type Range, rangeToWindow } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

const N = DASHBOARD.readoutSparkPoints

/** Hours a range's momentum spans; "all" has no window before it, so it uses the 7 day momentum. */
const momentumHours = (range: Range, now: number) =>
  range === "all" ? 7 * 24 : (now - rangeToWindow(range, now).from) / HOUR_MS

/** Theme rows with articles per hour over the last N hours and the streams their stories fall in. */
const withCards = async <T extends { id: number }>(d: Db, rows: T[]) => {
  const to = hourBucket(Date.now())
  const from = to - N * HOUR_MS
  const ids = rows.map((r) => r.id)
  const [spark, streams] = await Promise.all([
    rollupBuckets(d, "theme", ids.map(String), from, to),
    themeStreams(d, ids),
  ])
  const count = byKeyBucket(spark)
  const hours = bucketsBetween(from, to)
  return rows.map((r) => ({
    ...r,
    spark: hours.map((b) => count(r.id, b)),
    streams: CATEGORIES.filter((c) => streams.some((s) => s.themeId === r.id && s.category === c)),
  }))
}

/** Rising before flat before falling, each the largest swing first; a rise from 0 (null) is the largest. */
const side = (m: number | null) => (m === null || m > 0 ? 0 : m === 0 ? 1 : 2)
const swing = (m: number | null) => (m === null ? 1e9 : Math.abs(m))

/** The front page board: active themes with the largest swings in the range, and how many active themes rise. */
export const signalBoard = query(z.enum(RANGES), async (range) => {
  const d = db()
  const now = Date.now()
  const hours = momentumHours(range, now)
  const [rows, rising] = await Promise.all([
    themeList(d, { statuses: ["active"], hours, now, order: "swing", limit: DASHBOARD.signalBoard }),
    risingThemes(d, hours, now),
  ])
  const sorted = rows.toSorted((a, b) => side(a.momentum) - side(b.momentum) || swing(b.momentum) - swing(a.momentum))
  const compare = range !== "all"
  return {
    suffix: compare ? range : "7d",
    cards: await withCards(d, sorted),
    rising: {
      value: rising.recent,
      delta: compare ? momentum(rising) : undefined,
      note: compare ? `vs previous ${range}` : "over 7d",
    },
  }
})

/** Themes in a status, or all of them, latest story first, one page at a time. */
export const signalList = query(
  z.object({ status: z.enum([...THEME_STATUSES, "all"]), page: z.number().int().positive() }),
  async ({ status, page }) => {
    const d = db()
    const size = DASHBOARD.storiesPageSize
    const rows = await themeList(d, {
      statuses: status === "all" ? [...THEME_STATUSES] : [status],
      hours: 24,
      now: Date.now(),
      order: "recent",
      limit: size + 1,
      offset: (page - 1) * size,
    })
    return { rows: await withCards(d, rows.slice(0, size)), more: rows.length > size }
  },
)
