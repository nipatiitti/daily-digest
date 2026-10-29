import { nice, ticks } from "d3-array"
import { line } from "d3-shape"
import { fmtDate, fmtInt, fmtTime } from "../components/format.ts"

/** A colour slot (`--stream-<n>`); a ninth stream folds into Other. */
export type Stream = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | "other"

const DAY = 86_400_000

export const streamVar = (slot: Stream) => `var(--stream-${slot})`

/** Ticks from zero on a nice scale that covers `max`; the last tick is the top of the axis. */
export const niceTicks = (max: number, count = 5) => ticks(0, nice(0, max > 0 ? max : 1, count)[1], count)

/** Indices of at most `maxCount` evenly spaced labels, keeping the last one when it has room. */
export const thinLabels = (labels: readonly unknown[], maxCount: number) => {
  const last = labels.length - 1
  const step = Math.max(1, Math.ceil(last / Math.max(1, maxCount - 1)))
  const shown: number[] = []
  for (let i = 0; i <= last; i += step) shown.push(i)
  if (last % step >= step / 2) shown.push(last)
  return shown
}

/** An axis label: "06:00Z" when the axis spans two days or less, else "27 Oct". `full` adds the day to hours. */
export const fmtTick = (iso: string, range: number, full = false) => {
  const ms = Date.parse(iso)
  if (range > 2 * DAY) return fmtDate(ms)
  // fmtTime drops the day when `now` falls on the same day, so passing the time itself gives just the hour.
  return fmtTime(ms, full ? 0 : ms)
}

/** A value with its unit: integers through fmtInt, fractions to two places at most. */
export const fmtValue = (n: number, unit = "") =>
  `${Number.isInteger(n) ? fmtInt(n) : `${n < 0 ? "−" : ""}${+Math.abs(n).toFixed(2)}`}${unit}`

/** Straight segments through `values`; the stroke's round joins do the rest. */
export const linePath = (values: readonly number[], x: (i: number) => number, y: (v: number) => number) =>
  line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(values) ?? ""
