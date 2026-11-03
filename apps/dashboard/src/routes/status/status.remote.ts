import { env } from "cloudflare:workers"
import { DAY_MS, HOUR_MS, hourBucket, STATUS } from "@digest/core"
import {
  DASHBOARD_LLM_PURPOSES,
  LLM_PURPOSES,
  pollSourceNow,
  resetSourceBackoff,
  setSourceEnabled,
  statusPage,
} from "@digest/db"
import { z } from "zod"
import type { Stream } from "#lib/charts/scale.ts"
import { fmtDate, fmtTime } from "#lib/components/format.ts"
import { attempt } from "#lib/forms.ts"
import { db } from "#lib/server/db.ts"
import { answerCapUsd } from "#lib/server/llm.ts"
import { form, query } from "$app/server"

const DASHBOARD_PURPOSES: readonly string[] = DASHBOARD_LLM_PURPOSES

/** `n` bucket starts `step` apart, the last one `last`. */
const span = (last: number, n: number, step: number) => Array.from({ length: n }, (_, i) => last - (n - 1 - i) * step)

/**
 * The status page: the database reads, with spend charted per UTC day and purpose against both caps, same-event
 * decisions charted per hour, and the hourly steps and loop writes aged against STATUS.loopStaleHours.
 */
export const status = query(async () => {
  const now = Date.now()
  const today = now - (now % DAY_MS)
  const days = span(today, STATUS.spendDays, DAY_MS)
  const s = await statusPage(db(), now, {
    spendFrom: days[0] ?? today,
    hours: STATUS.clusterHours,
    editions: STATUS.editions,
  })
  const caps = { pipeline: Number(env.DAILY_SPEND_CAP_USD), dashboard: answerCapUsd() }
  const purposes = LLM_PURPOSES.filter((p) => s.spend.some((r) => r.purpose === p))
  const usd = new Map(s.spend.map((r) => [`${r.day}/${r.purpose}`, r.usd]))
  const spentToday = (dashboard: boolean) =>
    s.spend
      .filter((r) => r.day === today && DASHBOARD_PURPOSES.includes(r.purpose) === dashboard)
      .reduce((a, r) => a + r.usd, 0)
  const pairs = new Map(s.pairs.map((r) => [r.hour, r]))
  const loopRow = (name: string, last: number | null, detail: Record<string, number> | null = null) => ({
    name,
    last,
    age: last === null ? null : now - last,
    stale: last === null || now - last > STATUS.loopStaleHours * HOUR_MS,
    detail: Object.entries(detail ?? {}),
  })
  return {
    ...s,
    now,
    caps,
    today: { pipeline: spentToday(false), dashboard: spentToday(true) },
    spend: days.map((day) => ({
      label: fmtDate(day),
      values: purposes.map((name, i) => ({
        name,
        value: usd.get(`${day}/${name}`) ?? 0,
        stream: (i < 8 ? i + 1 : "other") as Stream,
      })),
    })),
    pairs: span(hourBucket(now), STATUS.clusterHours, HOUR_MS).map((h) => ({
      label: fmtTime(h, h),
      values: [
        { name: "Merged", value: pairs.get(h)?.merged ?? 0 },
        { name: "Rejected", value: pairs.get(h)?.rejected ?? 0, stream: 2 as Stream },
      ],
    })),
    loop: [
      ...s.runs.map((r) => loopRow(r.step, r.lastRunAt, r.detailJson)),
      loopRow("Newest movers bucket", s.lag.movers),
      loopRow("Newest relevance score", s.lag.relevance),
      loopRow("Newest event placement", s.lag.placed),
    ],
  }
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
    await status().refresh()
  },
)
