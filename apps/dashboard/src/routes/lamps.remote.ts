import { env } from "cloudflare:workers"
import { LAMPS } from "@digest/core"
import { dashboardSpendSince, lampInputs } from "@digest/db"
import { db } from "#lib/server/db.ts"
import { answerCapUsd } from "#lib/server/llm.ts"
import { getRequestEvent, query } from "$app/server"

type LampState = "live" | "stale" | "off" | "alert"

/**
 * The header lamps: is fetching producing items, is evaluation keeping up, how much of today's pipeline Claude cap
 * is spent. The spend title also shows the dashboard answers against their own cap.
 */
export const lamps = query(async () => {
  const now = Date.now()
  const [{ minutesSinceNewItem: mins, evalBacklog, spendTodayUsd }, answers] = await Promise.all([
    lampInputs(db(), now),
    dashboardSpendSince(db(), now - (now % 86_400_000)),
  ])
  const cap = Number(env.DAILY_SPEND_CAP_USD)
  const pct = (spendTodayUsd / cap) * 100
  const fetching: LampState =
    mins === null || mins >= LAMPS.fetchOffMinutes ? "off" : mins >= LAMPS.fetchStaleMinutes ? "stale" : "live"
  const evaluation: LampState =
    evalBacklog >= LAMPS.evalBacklogAlert ? "alert" : evalBacklog >= LAMPS.evalBacklogStale ? "stale" : "live"
  const spend: LampState = pct >= 100 ? "alert" : pct >= LAMPS.spendStalePct ? "stale" : "live"
  return [
    { label: "Fetch", state: fetching, title: mins === null ? "No items yet" : `${mins} min ago` },
    { label: "Eval", state: evaluation, title: `${evalBacklog} queued` },
    {
      label: "Spend",
      state: spend,
      title: `${spendTodayUsd.toFixed(2)} of ${cap.toFixed(2)} USD pipeline, ${answers.toFixed(2)} of ${answerCapUsd().toFixed(2)} USD answers`,
    },
  ]
})

/** The signed-in email for the layout footer (set by hooks.server.ts). */
export const user = query(() => getRequestEvent().locals.user)
