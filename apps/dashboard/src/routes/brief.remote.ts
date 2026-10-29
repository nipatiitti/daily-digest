import { env } from "cloudflare:workers"
import { bucketsBetween, DASHBOARD, FORECAST, HOUR_MS, holtLinear, hourBucket, momentum } from "@digest/core"
import {
  activeStoryTotals,
  CATEGORIES,
  type Db,
  deskSlices,
  evaluationSlices,
  firstDeskBucket,
  opsCounts,
  previousDigestSentAt,
  rankedStories,
  rollupBuckets,
  rollupTotals,
  spendSince,
  staleSources,
  storyFacts,
} from "@digest/db"
import { z } from "zod"
import { fmtInt } from "#lib/components/format.ts"
import { STREAM_NAMES, streamSlot } from "#lib/components/streams.ts"
import { DAY_MS, previousWindow, RANGES, type Range, rangeToWindow } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

const rangeSchema = z.enum(RANGES)
const N = DASHBOARD.readoutSparkPoints
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** The range's window, with "all" starting at the first desk bucket rather than 1970. */
const windowOf = async (d: Db, range: Range, now: number) => {
  const w = rangeToWindow(range, now)
  return w.from > 0 ? w : { ...w, from: (await firstDeskBucket(d)) ?? now }
}

/** Counts over 2N slices of a window and the one before it: the second half is the spark, the halves give the delta. */
const trend = (rows: { slice: number; n: number }[]) => {
  const all = Array<number>(2 * N).fill(0)
  for (const r of rows) all[r.slice] = r.n
  const spark = all.slice(N)
  return { value: sum(spark), spark, delta: momentum({ recent: sum(spark), previous: sum(all.slice(0, N)) }) }
}

/** Article counts from rollup rows, looked up by key and bucket. */
const byKeyBucket = (rows: { key: string; bucket: number; articles: number }[]) => {
  const got = new Map(rows.map((r) => [`${r.key}/${r.bucket}`, r.articles]))
  return (key: string | number, bucket: number) => got.get(`${key}/${bucket}`) ?? 0
}

/** The four headline numbers, each with a delta against the previous window and a spark over the current one. */
export const readouts = query(rangeSchema, async (range) => {
  const d = db()
  const now = Date.now()
  const w = await windowOf(d, range, now)
  const digestAt = (await previousDigestSentAt(d)) ?? now - DAY_MS
  const [desk, digestDesk, evals, totals] = await Promise.all([
    deskSlices(d, previousWindow(w).from, now, 2 * N),
    deskSlices(d, previousWindow({ from: digestAt, to: now }).from, now, 2 * N),
    evaluationSlices(d, previousWindow(w).from, now, 2 * N),
    activeStoryTotals(d, digestAt),
  ])
  const vs = range === "all" ? "all time" : `vs previous ${range}`
  const newStories = (rows: typeof desk) => trend(rows.map((r) => ({ slice: r.slice, n: r.newStories })))
  return [
    {
      label: "Active stories",
      ...newStories(desk),
      value: totals.active,
      note: `new stories ${vs}`,
      href: `/stories?range=${range}`,
    },
    {
      label: "New since digest",
      ...newStories(digestDesk),
      value: totals.newSince,
      note: `vs the ${fmtInt((now - digestAt) / HOUR_MS)} hours before`,
      href: "/data/stories",
    },
    {
      label: "Articles",
      ...trend(desk.map((r) => ({ slice: r.slice, n: r.articles }))),
      note: vs,
      href: "/data/articles",
    },
    { label: "Evaluations", ...trend(evals), note: vs, href: "/data/llm_calls" },
  ]
})

/**
 * Articles per stream and bucket. Hourly ranges end at the last complete hour and append a Holt projection fed by
 * FORECAST.historyHours of history; day-bucketed ranges have no projection.
 */
export const streamSeries = query(rangeSchema, async (range) => {
  const d = db()
  const now = Date.now()
  const { from, bucketMs } = await windowOf(d, range, now)
  const hourly = bucketMs === HOUR_MS
  const to = hourly ? hourBucket(now) : now
  const first = Math.floor(from / bucketMs) * bucketMs
  const start = hourly ? Math.min(first, to - FORECAST.historyHours * HOUR_MS) : first
  const count = byKeyBucket(await rollupTotals(d, "stream", [...CATEGORIES], start, to, bucketMs))
  const buckets = bucketsBetween(start, to).filter((b) => b % bucketMs === 0)
  const skip = (first - start) / bucketMs
  const shown = [...buckets.slice(skip), ...(hourly ? bucketsBetween(to, to + FORECAST.horizonHours * HOUR_MS) : [])]
  const bucket = hourly ? "hour" : "day"
  return {
    bucket,
    labels: shown.map((b) => new Date(b).toISOString()),
    hrefs: shown.map((b) => `/stories?${bucket}=${b}`),
    series: CATEGORIES.map((c) => {
      const values = buckets.map((b) => count(c, b))
      const projection = hourly ? holtLinear(values.slice(-FORECAST.historyHours)) : []
      return { name: STREAM_NAMES[c], stream: streamSlot(c), values: [...values.slice(skip), ...projection] }
    }),
    projectFrom: hourly ? buckets.length - skip - 1 : undefined,
  }
})

/** The best active stories with an article in the range, each with an hourly spark, and the lead's facts. */
export const topStories = query(rangeSchema, async (range) => {
  const d = db()
  const now = Date.now()
  const stories = await rankedStories(d, { from: rangeToWindow(range, now).from, limit: DASHBOARD.topStories })
  const sparkFrom = hourBucket(now) - (N - 1) * HOUR_MS
  const hours = bucketsBetween(sparkFrom, now)
  const lead = stories[0]
  const [rows, facts] = await Promise.all([
    rollupBuckets(
      d,
      "story",
      stories.map((s) => String(s.id)),
      sparkFrom,
      now,
    ),
    lead ? storyFacts(d, lead.id, DASHBOARD.leadFacts) : [],
  ])
  const count = byKeyBucket(rows)
  return { stories: stories.map((s) => ({ ...s, spark: hours.map((b) => count(s.id, b)) })), facts }
})

/** The quiet row at the foot of the page, values already formatted. */
export const opsStrip = query(async () => {
  const d = db()
  const now = Date.now()
  const since = now - DAY_MS
  const [[evals], ops, stale, spend] = await Promise.all([
    evaluationSlices(d, since, now, 1),
    opsCounts(d, since),
    staleSources(d, now),
    spendSince(d, now - (now % DAY_MS)),
  ])
  const cap = Number(env.DAILY_SPEND_CAP_USD)
  return [
    { label: "Evaluations, 24h", value: fmtInt(evals?.n ?? 0), href: "/data/llm_calls" },
    { label: "Would alert, 24h", value: fmtInt(ops.wouldAlert), href: "/data/gate_log" },
    { label: "Stale sources", value: fmtInt(stale.length), href: "/ops" },
    { label: "Spend today", value: `${spend.toFixed(2)} of ${cap.toFixed(2)} USD`, href: "/ops" },
    {
      label: "Database",
      value: ops.dbBytes === null ? "Not measured" : `${(ops.dbBytes / 1e9).toFixed(2)} GB`,
      href: "/data/db_stats",
    },
  ]
})
