export const HOUR_MS = 3_600_000

/** Start of the UTC hour holding `ms`. */
export const hourBucket = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS

/**
 * Hour starts covering the half-open range [from, to): the bucket holding `from` is included, and the bucket
 * holding `to` only when `to` falls inside it, so a `to` on an hour boundary ends the list before that hour.
 */
export const bucketsBetween = (from: number, to: number) => {
  const buckets: number[] = []
  for (let b = hourBucket(from); b < to; b += HOUR_MS) buckets.push(b)
  return buckets
}

export type Momentum = { pct: number | null; recent: number; previous: number }

/**
 * Signed percent change, rounded half away from zero like SQLite's round(). A rise from 0 has no percentage
 * (pct null, the UI says "from 0 to 4"); 0 to 0 is 0.
 */
export const momentum = ({ recent, previous }: { recent: number; previous: number }): Momentum => {
  if (previous === 0) return { pct: recent === 0 ? 0 : null, recent, previous }
  const change = (100 * (recent - previous)) / previous
  return { pct: Math.sign(change) * Math.round(Math.abs(change)), recent, previous }
}
