import { env } from "cloudflare:workers"
import { DASHBOARD, HOUR_MS, SCORING } from "@digest/core"
import {
  calibrationBands,
  DASHBOARD_LLM_PURPOSES,
  dbSizes,
  evaluatedPerDay,
  GATE_DECISIONS,
  GATES,
  gateLogPage,
  LLM_PURPOSES,
  loopHealth,
  ROLLUP_KINDS,
  spendByDay,
} from "@digest/db"
import { z } from "zod"
import type { Stream } from "#lib/charts/scale.ts"
import { fmtDate } from "#lib/components/format.ts"
import { SEVERITY_WORDS } from "#lib/components/severity.ts"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { answerCapUsd } from "#lib/server/llm.ts"
import { query } from "$app/server"

/** An hourly step or rollup kind not written for this long is marked stale. */
const STALE_MS = DASHBOARD.loopStaleHours * HOUR_MS

const DASHBOARD_PURPOSES: readonly string[] = DASHBOARD_LLM_PURPOSES

/** The UTC day starts of the chart span, today last. */
const chartDays = (now: number) => {
  const n = DASHBOARD.storyChartDays
  const today = now - (now % DAY_MS)
  return Array.from({ length: n }, (_, i) => today - (n - 1 - i) * DAY_MS)
}

/**
 * Claude spend per UTC day and purpose over the chart span, stacked, with both daily caps; today's spend per purpose
 * against the cap it counts toward; and spend per purpose and model over the span.
 */
export const spend = query(async () => {
  const days = chartDays(Date.now())
  const today = days.at(-1)
  const { days: rows, models } = await spendByDay(db(), days[0] ?? 0)
  const pipelineCap = Number(env.DAILY_SPEND_CAP_USD)
  const dashboardCap = answerCapUsd()
  const purposes = LLM_PURPOSES.filter((p) => rows.some((r) => r.purpose === p))
  const usd = new Map(rows.map((r) => [`${r.day}/${r.purpose}`, r.usd]))
  return {
    caps: [
      { label: `Pipeline cap ${pipelineCap.toFixed(2)} USD`, value: pipelineCap },
      { label: `Dashboard cap ${dashboardCap.toFixed(2)} USD`, value: dashboardCap },
    ],
    items: days.map((day) => ({
      label: fmtDate(day),
      values: purposes.map((name, i) => ({
        name,
        value: usd.get(`${day}/${name}`) ?? 0,
        stream: (i < 8 ? i + 1 : "other") as Stream,
      })),
    })),
    today: rows
      .filter((r) => r.day === today)
      .map((r) => {
        const dashboard = DASHBOARD_PURPOSES.includes(r.purpose)
        const cap = dashboard ? dashboardCap : pipelineCap
        return { ...r, cap: dashboard ? "Dashboard" : "Pipeline", share: r.usd / cap }
      }),
    models,
  }
})

/** The gate log's URL params; empty values are no filter, `date` is a UTC day and `after` a gate log ID. */
const gateParams = z
  .string()
  .transform((search) => Object.fromEntries([...new URLSearchParams(search)].filter(([, v]) => v.trim())))
  .pipe(
    z.object({
      gate: z.enum(GATES).optional(),
      decision: z.enum(GATE_DECISIONS).optional(),
      shadow: z.enum(["yes", "no"]).optional(),
      date: z.iso.date().optional(),
      after: z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .optional(),
    }),
  )

/** A page of the gate log, filtered as the URL query string says, newest first, with the filter choices. */
export const gates = query(gateParams, async ({ shadow, date, ...f }) => {
  const from = date === undefined ? undefined : Date.parse(`${date}T00:00:00Z`)
  const page = await gateLogPage(db(), {
    ...f,
    shadow: shadow === undefined ? undefined : shadow === "yes",
    from,
    to: from === undefined ? undefined : from + DAY_MS,
    limit: DASHBOARD.browsePageSize,
  })
  return { ...page, gates: GATES, decisions: GATE_DECISIONS }
})

/** Distinct stories StoryEval extracted per UTC day over the chart span, today last. */
export const evaluations = query(async () => {
  const days = chartDays(Date.now())
  const rows = await evaluatedPerDay(db(), days[0] ?? 0)
  const byDay = new Map(rows.map((r) => [r.day, r.stories]))
  return days.map((day) => ({ label: fmtDate(day), values: [{ name: "Stories", value: byDay.get(day) ?? 0 }] }))
})

/** Database size per measured day over the chart span, oldest first, and the newest day's row counts, most first. */
export const database = query(async () => {
  const rows = await dbSizes(db(), DASHBOARD.storyChartDays)
  return {
    items: rows.toReversed().map((r) => ({
      label: fmtDate(Date.parse(r.day)),
      values: [{ name: "Size", value: Math.round(r.sizeBytes / 1e6) }],
    })),
    tables: Object.entries(rows[0]?.rowsJson ?? {}).toSorted((a, b) => b[1] - a[1]),
    day: rows[0]?.day ?? null,
  }
})

/** Delivered stories and their votes per score band, the bands named as the severity meter names them. */
export const calibration = query(async () => {
  const bounds = SCORING.tierBounds
  const rows = await calibrationBands(db(), bounds)
  const range = (band: number) =>
    band === 0
      ? `under ${bounds[0]}`
      : band === bounds.length
        ? `${bounds[band - 1]} and over`
        : `${bounds[band - 1]} to ${bounds[band]}`
  return rows.map((r) => ({
    ...r,
    label: r.band === null ? "Unscored" : `${SEVERITY_WORDS[r.band]}, ${range(r.band)}`,
    rate: r.up + r.down ? r.up / (r.up + r.down) : null,
  }))
})

/** Each hourly step's last run and each rollup kind's newest write in the last day, stale past STALE_MS. */
export const loop = query(async () => {
  const now = Date.now()
  const { runs, rollups } = await loopHealth(db(), now - DAY_MS)
  const at = new Map(rollups.map((r) => [r.kind, r.updatedAt]))
  const row = (name: string, last: number | null, detail: Record<string, number> | null) => ({
    name,
    last,
    age: last === null ? null : now - last,
    stale: last === null || now - last > STALE_MS,
    detail: Object.entries(detail ?? {}),
  })
  return {
    steps: runs.map((r) => row(r.step, r.lastRunAt, r.detailJson)),
    rollups: ROLLUP_KINDS.map((k) => row(k, at.get(k) ?? null, null)),
  }
})
