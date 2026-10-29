import { HOUR_MS } from "@digest/core"

export const DAY_MS = 24 * HOUR_MS

export const RANGES = ["24h", "7d", "30d", "90d", "all"] as const
export type Range = (typeof RANGES)[number]

/** Unix ms, `to` exclusive; `bucketMs` is the chart bucket for the range. */
export type Window = { from: number; to: number; bucketMs: number }

const DAYS: Record<Exclude<Range, "all">, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 }

/** A `?range=` value, "7d" when missing or unknown. */
export const parseRange = (value: string | null): Range => RANGES.find((r) => r === value) ?? "7d"

/** Hour buckets up to a week, day buckets beyond; "all" starts at 0. */
export const rangeToWindow = (range: Range, now: number): Window => ({
  from: range === "all" ? 0 : now - DAYS[range] * DAY_MS,
  to: now,
  bucketMs: range === "24h" || range === "7d" ? HOUR_MS : DAY_MS,
})

/** The window of the same length immediately before, for deltas. */
export const previousWindow = <W extends { from: number; to: number }>(w: W): W => ({
  ...w,
  from: 2 * w.from - w.to,
  to: w.from,
})
