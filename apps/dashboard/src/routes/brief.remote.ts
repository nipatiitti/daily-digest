import { env } from "cloudflare:workers"
import { bucketsBetween, DASHBOARD, FORECAST, HOUR_MS, holtLinear, hourBucket, momentum } from "@digest/core"
import {
  activeStoryTotals,
  CATEGORIES,
  type Db,
  deskSlices,
  entityByKey,
  evaluationSlices,
  firstDeskBucket,
  opsCounts,
  previousDigestSentAt,
  type RollupKind,
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

/**
 * Counts over `n` slices of a window, after `n` slices of the window before it when `compare` is set: the last `n`
 * are the spark and the value, and the two halves give the delta.
 */
const trend = (rows: { slice: number; n: number }[], n: number, compare: boolean) => {
  const all = Array<number>(compare ? 2 * n : n).fill(0)
  for (const r of rows) all[r.slice] = r.n
  const spark = all.slice(-n)
  const value = sum(spark)
  return { value, spark, delta: compare ? momentum({ recent: value, previous: sum(all.slice(0, n)) }) : undefined }
}

/** Article counts from rollup rows, looked up by key and bucket. */
const byKeyBucket = (rows: { key: string; bucket: number; articles: number }[]) => {
  const got = new Map(rows.map((r) => [`${r.key}/${r.bucket}`, r.articles]))
  return (key: string | number, bucket: number) => got.get(`${key}/${bucket}`) ?? 0
}

/**
 * The four headline numbers over complete hours, each with a spark over the current window and, except for "all", a
 * delta against the window before it.
 */
export const readouts = query(rangeSchema, async (range) => {
  const d = db()
  const at = Date.now()
  const now = hourBucket(at)
  const w = await windowOf(d, range, now)
  const compare = range !== "all"
  const from = compare ? previousWindow(w).from : w.from
  const slices = compare ? 2 * N : N
  const digestAt = (await previousDigestSentAt(d)) ?? at - DAY_MS
  const sinceDigest = Math.min(hourBucket(digestAt), now - HOUR_MS)
  const hours = (now - sinceDigest) / HOUR_MS
  const n = Math.min(N, hours)
  const [desk, digestDesk, evals, totals] = await Promise.all([
    deskSlices(d, from, now, slices),
    deskSlices(d, previousWindow({ from: sinceDigest, to: now }).from, now, 2 * n),
    evaluationSlices(d, from, now, slices),
    activeStoryTotals(d, digestAt),
  ])
  const vs = compare ? `vs previous ${range}` : "all time"
  const q = `?range=${range}`
  const newStories = (rows: typeof desk) => rows.map((r) => ({ slice: r.slice, n: r.newStories }))
  const articles = desk.map((r) => ({ slice: r.slice, n: r.articles }))
  return [
    {
      label: "Active stories",
      ...trend(newStories(desk), N, compare),
      value: totals.active,
      note: `new stories ${vs}`,
      href: `/stories${q}`,
    },
    {
      label: "New since digest",
      ...trend(newStories(digestDesk), n, true),
      note: `vs the ${fmtInt(hours)} ${hours === 1 ? "hour" : "hours"} before`,
      href: "/data/stories",
    },
    {
      label: "Articles",
      ...trend(articles, N, compare),
      note: vs,
      href: `/data/articles${q}`,
    },
    { label: "Evaluations", ...trend(evals, N, compare), note: vs, href: `/data/llm_calls${q}` },
  ]
})

/**
 * The big chart's buckets for a range. Hourly ranges end at the last complete hour and append a Holt projection fed
 * by FORECAST.historyHours of history, so reads start that far back at least; day-bucketed ranges end on today, drawn
 * as partial after the last complete day. `counts` reads articles per key and bucket over the read span, and `values`
 * turns one key's counts into the drawn line.
 */
const chartWindow = async (d: Db, range: Range, now: number) => {
  const { from, bucketMs } = await windowOf(d, range, now)
  const hourly = bucketMs === HOUR_MS
  const to = hourly ? hourBucket(now) : now
  const first = Math.floor(from / bucketMs) * bucketMs
  const start = hourly ? Math.min(first, to - FORECAST.historyHours * HOUR_MS) : first
  const buckets = bucketsBetween(start, to).filter((b) => b % bucketMs === 0)
  const skip = (first - start) / bucketMs
  return {
    hourly,
    to,
    measured: buckets.slice(skip),
    counts: async (kind: RollupKind, keys: string[]) =>
      byKeyBucket(await rollupTotals(d, kind, keys, start, to, bucketMs)),
    values: (count: (bucket: number) => number) => {
      const values = buckets.map(count)
      const projection = hourly ? holtLinear(values.slice(-FORECAST.historyHours)) : []
      return [...values.slice(skip), ...projection]
    },
  }
}

/** Articles per stream and bucket, as chartWindow draws them. Point links cover measured buckets only. */
export const streamSeries = query(rangeSchema, async (range) => {
  const d = db()
  const { hourly, to, measured, counts, values } = await chartWindow(d, range, Date.now())
  const count = await counts("stream", [...CATEGORIES])
  const shown = [...measured, ...(hourly ? bucketsBetween(to, to + FORECAST.horizonHours * HOUR_MS) : [])]
  const bucket = hourly ? "hour" : "day"
  return {
    bucket,
    labels: shown.map((b) => new Date(b).toISOString()),
    hrefs: measured.map((b) => `/stories?range=${range}&${bucket}=${b}`),
    series: CATEGORIES.map((c) => ({
      name: STREAM_NAMES[c],
      stream: streamSlot(c),
      values: values((b) => count(c, b)),
    })),
    projectFrom: Math.max(0, measured.length - (hourly ? 1 : 2)),
  }
})

/** One entity's articles per bucket, lined up with streamSeries; null for an unknown key. */
export const seriesFor = query(
  z.object({ kind: z.literal("entity"), key: z.string(), range: rangeSchema }),
  async ({ kind, key, range }) => {
    const d = db()
    const entity = await entityByKey(d, key)
    if (!entity) return null
    const { counts, values } = await chartWindow(d, range, Date.now())
    const count = await counts(kind, [String(entity.id)])
    return { key, name: entity.name, stream: "other" as const, values: values((b) => count(entity.id, b)) }
  },
)

/** The best active stories with an article in the range, each with an hourly spark, and the lead's facts. */
export const topStories = query(rangeSchema, async (range) => {
  const d = db()
  const now = Date.now()
  const stories = await rankedStories(d, { from: rangeToWindow(range, now).from, limit: DASHBOARD.topStories })
  const sparkTo = hourBucket(now)
  const sparkFrom = sparkTo - N * HOUR_MS
  const hours = bucketsBetween(sparkFrom, sparkTo)
  const lead = stories[0]
  const [rows, facts] = await Promise.all([
    rollupBuckets(
      d,
      "story",
      stories.map((s) => String(s.id)),
      sparkFrom,
      sparkTo,
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
