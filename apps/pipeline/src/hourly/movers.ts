import { countryName, DAY_MS, HOUR_MS, HOURLY, hourBucket, MOVERS, momentum } from "@digest/core"
import { type Db, moverEventTitles, moverTotals, replaceMovers } from "@digest/db"
import { type Llm, moverReasons } from "@digest/llm"
import { outletKeys } from "../ingest.ts"
import { overSoftCap } from "../llm.ts"
import { log } from "../util.ts"

type Mover = Awaited<ReturnType<typeof moverTotals>>[number] & {
  name: string
  change24h: number | null
  change7d: number | null
}

/** The 24 hour rise that ranks a mover; a rise from 0 has no percentage and ranks as 100 per article. */
const rise = (m: Mover) => m.change24h ?? 100 * m.recentShort

/**
 * The hour's top movers across active threads, entities and countries: articles over the momentum windows against
 * the windows before, rising only, outlets left out since they are not news. Haiku writes a line for the first few
 * from their top event titles; without an LLM, over the soft cap or on a failed call the rows go without reasons.
 */
export const moversStep = async (db: Db, llm: Llm | null, now: number) => {
  const bucket = hourBucket(now)
  const { short, long } = HOURLY.momentumWindows
  const [totals, outlets] = await Promise.all([
    moverTotals(db, bucket, { short, long, minArticles: MOVERS.minArticles }),
    outletKeys(db),
  ])
  const top = totals
    .filter((t) => t.entityKey === null || !outlets.has(t.entityKey))
    .map((t) => ({
      ...t,
      name: t.name ?? countryName(t.key),
      change24h: momentum({ recent: t.recentShort, previous: t.previousShort }).pct,
      change7d: momentum({ recent: t.recentLong, previous: t.previousLong }).pct,
    }))
    .filter((m) => m.change24h === null || m.change24h > 0)
    .sort((a, b) => rise(b) - rise(a) || b.recentShort - a.recentShort)
    .slice(0, MOVERS.top)
  const { reasons, callId } = await explain(db, llm, top.slice(0, MOVERS.reasons), bucket - short * HOUR_MS, bucket)
  await replaceMovers(
    db,
    bucket,
    top.map((m, i) => {
      const reason = reasons.get(`${m.kind}:${m.key}`) ?? null
      return {
        bucket,
        kind: m.kind,
        key: m.key,
        name: m.name,
        articles24h: m.recentShort,
        change24h: m.change24h,
        change7d: m.change7d,
        rank: i + 1,
        reason,
        llmCallId: reason === null ? null : callId,
      }
    }),
    bucket - MOVERS.keepDays * DAY_MS,
  )
  return { movers: top.length, reasons: reasons.size }
}

const explain = async (db: Db, llm: Llm | null, movers: Mover[], from: number, to: number) => {
  const none = { reasons: new Map<string, string>(), callId: null }
  if (!llm || movers.length === 0) return none
  const over = await overSoftCap(llm)
  if (over) {
    log("movers_skipped", over)
    return none
  }
  try {
    const titles = await moverEventTitles(db, movers, { from, to, limit: MOVERS.eventTitles })
    return await moverReasons(
      llm,
      movers.map((m, i) => ({
        kind: m.kind,
        key: m.key,
        name: m.name,
        change24h: m.change24h,
        articles24h: m.recentShort,
        eventTitles: titles[i] ?? [],
      })),
    )
  } catch (e) {
    log("movers_reasons_failed", { error: String(e) })
    return none
  }
}
