import { env } from "cloudflare:workers"
import { askPeriod, countryName, DAY_MS, HOME, hourBucket } from "@digest/core"
import { readAskEvents, readAskThreads, readAskThreadsById } from "@digest/db"
import { askDesk, createLlm, type StreamCall } from "@digest/llm"
import { nearestEvents } from "./ask.ts"
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

/** Whole days from `ms` back to `now`. */
const daysAgo = (ms: number, now: number) => Math.max(0, Math.floor((now - ms) / DAY_MS))

/**
 * What Claude is asked for a question: the events nearest it by meaning within the period it names, oldest first,
 * their threads, and threads whose names hold its words. Ages count from the start of this hour, so an answer stays
 * cached within the hour unless what it reads changes.
 */
export const askCall = async (question: string): Promise<StreamCall> => {
  const d = db()
  const now = hourBucket(Date.now())
  const period = askPeriod(question, now)
  const [ids, named] = await Promise.all([
    nearestEvents(d, question, period),
    readAskThreads(d, wordsOf(question), HOME.askThreads),
  ])
  const events = (await readAskEvents(d, ids)).sort((a, b) => a.firstSeen - b.firstSeen || a.id - b.id)
  const linkedIds = [...new Set(events.flatMap((e) => (e.thread ? [e.thread.id] : [])))]
  const linked = await readAskThreadsById(d, linkedIds)
  const order = new Map(linkedIds.map((id, i) => [id, i]))
  const threads = [
    ...linked.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    ...named.filter((t) => !order.has(t.id)),
  ]
  return askDesk({
    question,
    period: { fromDaysAgo: daysAgo(period.from, now), toDaysAgo: period.to === null ? 0 : daysAgo(period.to, now) },
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      gist: e.gist,
      daysAgo: daysAgo(e.firstSeen, now),
      sources: e.independentOrigins,
      countries: e.countries.map(countryName),
      threadId: e.thread?.id ?? null,
    })),
    threads,
  })
}
