import { env } from "cloudflare:workers"
import { LAMPS } from "@digest/core"
import { lampInputs } from "@digest/db"
import { db } from "#lib/server/db.ts"
import { getRequestEvent, query } from "$app/server"

type LampState = "live" | "stale" | "off" | "alert"

/** The header lamps: is fetching producing items, is evaluation keeping up, how much of today's Claude cap is spent. */
export const lamps = query(async () => {
  const { minutesSinceNewItem: mins, evalBacklog, spendTodayUsd } = await lampInputs(db(), Date.now())
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
    { label: "Spend", state: spend, title: `${spendTodayUsd.toFixed(2)} of ${cap.toFixed(2)} USD` },
  ]
})

/** The signed-in email for the layout footer (set by hooks.server.ts). */
export const user = query(() => getRequestEvent().locals.user)
