import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
  DAY_MS,
  EDITION,
  type Edition,
  editionKey,
  eventCounters,
  freshness,
  HOUR_MS,
  importance,
  isSubstantial,
  RANKING,
  rankScore,
  votePenalty,
} from "@digest/core"
import {
  byEvent,
  changedEvents,
  claimDigest,
  clearShadow,
  currentProfile,
  type Db,
  eventEntityLinks,
  eventMembers,
  eventThreadLinks,
  finishDigest,
  getDb,
  latestRelevance,
  markShadowEdition,
  previousSentStart,
  previousShadowAsOf,
  recentThreadItems,
  saveShadow,
  sentEvents,
  voteBalances,
} from "@digest/db"
import { type CutCandidate, finalCut, type Llm, LlmRefusal, SpendCapError } from "@digest/llm"
import { parseChatIds, renderDigestHeader, renderEmptyDigest } from "@digest/telegram"
import { Api } from "grammy"
import { buildEventItems } from "./items.ts"
import { llmFor } from "./llm.ts"
import { followedName, relevanceStep, scoreEvents } from "./relevance.ts"
import { inSteps, sendDelivery } from "./send.ts"
import { log } from "./util.ts"

export type DigestV2Params = {
  /** YYYY-MM-DD (UTC); with the edition it makes the key (editionKey). */
  date: string
  edition: Edition
  /** "send" claims the edition in `digests` and sends it; "shadow" and "replay" write `digests_shadow` instead. */
  mode: "send" | "shadow" | "replay"
  /** Unix ms the edition is computed as of: a past edition's send time in a replay; else the instance's start. */
  asOf?: number
}

type Mode = DigestV2Params["mode"]
type Candidates = Awaited<ReturnType<typeof loadCandidates>>
type Scored = { eventId: number; score: number; reason: string }
type Selected = { eventId: number; score: number; relevance: number; reason: string }

/**
 * Substantial, unsent events counted as of `asOf`, with a member placed since the previous edition of this mode
 * (fetched since, for a replay): the previous sent edition's start for "send", the previous run's asOf otherwise.
 * Never further back than EDITION.maxLookbackHours.
 */
const loadCandidates = async (db: Db, mode: Mode, asOf: number) => {
  const previous = mode === "send" ? await previousSentStart(db) : await previousShadowAsOf(db, mode, asOf)
  const since = Math.max(previous ?? asOf - EDITION.windowHours * HOUR_MS, asOf - EDITION.maxLookbackHours * HOUR_MS)
  const changed = await changedEvents(db, since, asOf, mode === "replay" ? "fetched" : "placed")
  const [members, sent] = await Promise.all([eventMembers(db, changed, asOf), sentEvents(db, mode, changed, asOf)])
  const byId = byEvent(members)
  const rows = changed.flatMap((id) => {
    const own = byId.get(id) ?? []
    const counters = sent.has(id) ? null : eventCounters(own)
    if (!counters || !isSubstantial(counters)) return []
    return [{ id, ...counters, sources: [...new Set(own.map((m) => m.sourceName))] }]
  })
  return { since, changed: changed.length, sent: sent.size, rows }
}

/** A replay's relevance: the candidates as of asOf, scored against the current profile and never saved. */
const replayRelevance = async (db: Db, llm: Llm | null, c: Candidates): Promise<Scored[]> => {
  const current = llm ? await currentProfile(db) : null
  if (!llm || !current) return []
  const events = c.rows.map((r) => ({
    id: r.id,
    title: r.title,
    gist: r.gist,
    countries: r.countriesJson,
    eventType: r.eventType,
    advisoryOnly: r.advisoryOnly,
    sources: r.sources,
  }))
  return (await scoreEvents(db, llm, current.profile, events)).scores
}

/**
 * Relevance filters, rank, thread cooldown and the Haiku cut, one item per thread. A candidate whose primary thread
 * was sent in the latest EDITION.threadCooldownEditions editions goes to the cut with that headline only when its
 * origins reached EDITION.cooldownOriginsFactor times those of the thread's last item, or it ranks in the top half;
 * the cut sees the last headline and decides whether the thread moved. Without an LLM, or capped or refused, the top
 * EDITION.maxItems go, and the top-half exemption does not hold: a cooled thread needs the origins factor.
 */
const select = async (
  db: Db,
  llm: Llm | null,
  mode: Mode,
  asOf: number,
  c: Candidates,
  replayed: Scored[] | null,
): Promise<Selected[]> => {
  const current = await currentProfile(db)
  if (!current) {
    log("digest_v2_selected", { mode, asOf, skipped: "no profile" })
    return []
  }
  const ids = c.rows.map((r) => r.id)
  const [scores, threads, entities, votes, recent] = await Promise.all([
    replayed ? new Map(replayed.map((s) => [s.eventId, s])) : latestRelevance(db, ids),
    eventThreadLinks(db, ids),
    eventEntityLinks(db, ids),
    voteBalances(db, asOf - RANKING.voteWindowDays * DAY_MS, asOf),
    recentThreadItems(db, mode, asOf, EDITION.threadCooldownEditions),
  ])
  const counts = { unscored: 0, lowRelevance: 0, advisoryHeld: 0, cooled: 0 }
  const ranked = c.rows
    .flatMap((r) => {
      const rel = scores.get(r.id)
      const own = { threads: threads.get(r.id) ?? [], entities: entities.get(r.id) ?? [] }
      const followed = followedName(current.profile.follows, own.threads, own.entities, r.countriesJson)
      if (!rel) counts.unscored++
      else if (rel.score < EDITION.minRelevance) counts.lowRelevance++
      else if (r.advisoryOnly && !followed && rel.score < EDITION.advisoryMinRelevance) counts.advisoryHeld++
      else {
        const thread = own.threads[0] ?? null
        const worst = Math.min(
          thread ? (votes.threads.get(thread.threadId) ?? 0) : 0,
          ...own.entities.map((e) => votes.entities.get(e.entityId) ?? 0),
        )
        const score = rankScore(rel.score, importance(r), freshness(r.lastArticleAt, asOf), votePenalty(worst))
        return [{ r, rel, thread, score }]
      }
      return []
    })
    .sort((a, b) => b.score - a.score)

  const lastSent = new Map<number, { headline: string; origins: number }>()
  // Newest first, so each thread keeps its last item.
  for (const item of recent) {
    if (item.threadId !== null && !lastSent.has(item.threadId)) lastSent.set(item.threadId, item)
  }
  const topHalf = Math.ceil(ranked.length / 2)
  type Pooled = (typeof ranked)[number] & { cooledThread: { lastSentHeadline: string } | null; moved: boolean }
  const pool = ranked
    .flatMap((x, i): Pooled[] => {
      const last = x.thread && lastSent.get(x.thread.threadId)
      if (!last) return [{ ...x, cooledThread: null, moved: false }]
      const moved = x.r.independentOrigins >= EDITION.cooldownOriginsFactor * last.origins
      if (moved || i < topHalf) return [{ ...x, cooledThread: { lastSentHeadline: last.headline }, moved }]
      counts.cooled++
      return []
    })
    .slice(0, EDITION.candidates)

  let cut = "llm"
  let cutIds: number[] | null = null
  if (!llm) cut = "no llm"
  else {
    try {
      const offered = pool.map(
        (x): CutCandidate => ({
          id: x.r.id,
          title: x.r.title,
          gist: x.r.gist,
          threadName: x.thread?.name ?? null,
          countries: x.r.countriesJson,
          sources: x.r.sources,
          relevance: x.rel.score,
          reason: x.rel.reason,
          cooledThread: x.cooledThread,
        }),
      )
      cutIds = (await finalCut(llm, current.profile, offered, { min: EDITION.minItems, max: EDITION.maxItems })).ids
    } catch (e) {
      if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
      cut = String(e)
    }
  }
  const byId = new Map(pool.map((x) => [x.r.id, x]))
  const seenThreads = new Set<number>()
  const picked = (cutIds ? cutIds.flatMap((id) => byId.get(id) ?? []) : pool.filter((x) => !x.cooledThread || x.moved))
    .filter((x) => {
      if (!x.thread) return true
      if (seenThreads.has(x.thread.threadId)) return false
      seenThreads.add(x.thread.threadId)
      return true
    })
    .slice(0, EDITION.maxItems)
  log("digest_v2_selected", {
    mode,
    asOf,
    since: c.since,
    changed: c.changed,
    alreadySent: c.sent,
    substantial: c.rows.length,
    ...counts,
    ranked: ranked.length,
    offered: pool.length,
    cut,
    picked: picked.map((x) => x.r.id),
  })
  return picked.map((x) => ({ eventId: x.r.id, score: x.score, relevance: x.rel.score, reason: x.rel.reason }))
}

/**
 * The v2 digest edition, as of `asOf`: candidates are substantial events with a member placed since the previous
 * edition of the same mode and never sent, ranked by relevance x importance x freshness x vote penalty, cooled by
 * thread and cut by Haiku; Sonnet writes copy for the picks only. "send" claims the edition and sends one Telegram
 * message per item with vote buttons; "shadow" and "replay" write `digests_shadow`, replacing an earlier run's rows,
 * and record the run even when it picks nothing. A replay scores and writes copy without saving either.
 */
export class DigestV2 extends WorkflowEntrypoint<Env, DigestV2Params> {
  override async run(event: WorkflowEvent<DigestV2Params>, step: WorkflowStep) {
    const { date, edition, mode } = event.payload
    const asOf = event.payload.asOf ?? event.timestamp.getTime()
    const key = editionKey(date, edition)
    const db = getDb(this.env.DB)
    const llm = llmFor(this.env, db)

    if (mode === "send") {
      if (!(await step.do("claim", () => claimDigest(db, key)))) return { skipped: "already claimed" }
    } else {
      await step.do("clear shadow", async () => {
        await clearShadow(db, key, mode)
      })
    }

    const candidates = await step.do("candidates", () => loadCandidates(db, mode, asOf))
    // A replay scores with the current profile too: it shows what today's profile would have picked back then.
    const replayed = await step.do("relevance", async () => {
      if (mode === "replay") return replayRelevance(db, llm, candidates)
      await relevanceStep(db, llm, Date.now(), { eventIds: candidates.rows.map((r) => r.id) })
      return null
    })
    const selected = await step.do("select", () => select(db, llm, mode, asOf, candidates, replayed))
    const items = await step.do("render", async () => {
      const current = selected.length > 0 ? await currentProfile(db) : null
      if (!current) return []
      const built = await buildEventItems(
        db,
        llm,
        current.profile,
        selected.map((s) => s.eventId),
        asOf,
        { persist: mode !== "replay", reasons: new Map(selected.map((s) => [s.eventId, s.reason])) },
      )
      return selected.flatMap((s) => {
        const item = built.get(s.eventId)
        return item ? [{ ...s, ...item }] : []
      })
    })
    const headlines = items.map((i) => i.headline)

    if (mode !== "send") {
      await step.do("save shadow", async () => {
        await saveShadow(
          db,
          items.map((i, n) => ({
            editionKey: key,
            mode,
            rank: n + 1,
            eventId: i.eventId,
            threadId: i.threadId,
            score: i.score,
            relevance: i.relevance,
            text: i.text,
            asOf,
          })),
        )
      })
      await step.do("mark edition", async () => {
        await markShadowEdition(db, mode, key, asOf, EDITION.threadCooldownEditions)
      })
      return { key, mode, items: items.length, headlines }
    }

    const api = new Api(this.env.TELEGRAM_BOT_TOKEN)
    const chatIds = parseChatIds(this.env.TELEGRAM_CHAT_IDS)
    if (chatIds.length === 0) console.warn("TELEGRAM_CHAT_IDS is empty; nothing to send")
    const run = inSteps(step)

    let sent = 0
    for (const chatId of chatIds) {
      const base = { kind: "digest", digestDate: key, chatId } as const
      if (items.length === 0) {
        if (await sendDelivery(run, api, db, "empty", renderEmptyDigest(key), base)) sent++
        continue
      }
      await sendDelivery(run, api, db, "header", renderDigestHeader(key, items.length), base)
      for (const i of items) {
        const delivery = { ...base, eventId: i.eventId, threadId: i.threadId, scoreAtSend: i.score }
        if (await sendDelivery(run, api, db, `event ${i.eventId}`, i.text, { ...delivery, originsAtSend: i.origins })) {
          sent++
        }
      }
    }

    await step.do("finish", async () => {
      await finishDigest(db, key, sent > 0 || chatIds.length === 0 ? "sent" : "failed", items.length, Date.now())
    })
    return { key, mode, sent, items: items.length, headlines }
  }
}
