import { env } from "cloudflare:workers"
import { DAY_MS, HOME, hourBucket, isSubstantial } from "@digest/core"
import { readAskHits, readMovers } from "@digest/db"
import { askDesk, createLlm, type StreamCall } from "@digest/llm"
import { db } from "./db.ts"

/** Claude spend per UTC day on dashboard answers, counted over dashboard purposes only. */
export const answerCapUsd = () => Number(env.DASHBOARD_SPEND_CAP_USD) || HOME.spendCapUsd

/** Claude for on-demand answers; null until ANTHROPIC_API_KEY is set. */
export const llm = () =>
  env.ANTHROPIC_API_KEY
    ? createLlm({ apiKey: env.ANTHROPIC_API_KEY, db: db(), dailyCapUsd: Number(env.DAILY_SPEND_CAP_USD) })
    : null

/** The question's distinct words of three letters or more, the first HOME.askTerms. */
const wordsOf = (question: string) =>
  [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter((w) => w.length >= 3).slice(0, HOME.askTerms)

/**
 * What Claude is asked for a question: the threads and substantial events a search finds for its words, and the top
 * movers. Read as of the start of this hour, so an answer stays cached within the hour unless its data changes.
 */
export const askCall = async (question: string): Promise<StreamCall> => {
  const d = db()
  const since = hourBucket(Date.now()) - HOME.askDays * DAY_MS
  const [[threads, events], movers] = await Promise.all([
    readAskHits(d, wordsOf(question), { since, threads: HOME.askThreads, events: HOME.askEvents }),
    readMovers(d, HOME.movers),
  ])
  return askDesk({
    question,
    threads,
    events: events.filter(isSubstantial).slice(0, HOME.askEventsShown),
    movers: movers.map((m) => ({ ...m, threadId: m.kind === "thread" ? Number(m.key) : null })),
  })
}
