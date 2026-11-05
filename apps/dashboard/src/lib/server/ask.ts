import { env } from "cloudflare:workers"
import { type AskPeriod, EMBED, HOME } from "@digest/core"
import { articleEvents, type Db } from "@digest/db"

/** The question as a bge-m3 vector, the model the pipeline embeds gists with. */
const embedQuestion = async (question: string) => {
  const out = (await env.AI.run(EMBED.model, { text: [question], truncate_inputs: true })) as { data?: number[][] }
  const vector = out.data?.[0]
  if (!vector) throw new Error("the question's embedding came back empty")
  return vector
}

/**
 * The events nearest the question, best first, at most HOME.askEvents: its gist neighbours published in the period
 * grouped by the event each sits in now. An event scores its best neighbour's similarity plus up to
 * HOME.askSupportWeight for the rest, saturating over their summed similarity, so a widely reported match ranks above
 * a lone report of the same closeness.
 */
export const nearestEvents = async (db: Db, question: string, period: AskPeriod) => {
  const res = await env.GISTS.query(await embedQuestion(question), {
    topK: HOME.askTopK,
    returnMetadata: "none",
    filter: { published_at: period.to === null ? { $gte: period.from } : { $gte: period.from, $lt: period.to } },
  })
  const sims = new Map(res.matches.map((m) => [Number(m.id), m.score]))
  const byEvent = new Map<number, { best: number; sum: number }>()
  for (const r of await articleEvents(db, [...sims.keys()])) {
    const s = sims.get(r.articleId) ?? 0
    const e = byEvent.get(r.eventId)
    if (e) {
      e.best = Math.max(e.best, s)
      e.sum += s
    } else byEvent.set(r.eventId, { best: s, sum: s })
  }
  const score = ({ best, sum }: { best: number; sum: number }) => {
    const rest = sum - best
    return best + (HOME.askSupportWeight * rest) / (rest + HOME.askSupportHalf)
  }
  return [...byEvent]
    .map(([id, e]) => ({ id, score: score(e) }))
    .sort((a, b) => b.score - a.score || b.id - a.id)
    .slice(0, HOME.askEvents)
    .map((e) => e.id)
}
