import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
  DAY_MS,
  EDITION,
  type Edition,
  editionKey,
  eventCounters,
  freshness,
  gateOf,
  HOUR_MS,
  INTEREST,
  importance,
  isSubstantial,
  itemScore,
  JUDGE,
  qualifies,
  THREADS,
} from "@digest/core"
import {
  byEvent,
  changedEvents,
  claimDigest,
  clearEdition,
  codesFor,
  currentProfile,
  type Db,
  type EditionMode,
  type editionJudgments,
  eventEntityLinks,
  eventMembers,
  eventThreadLinks,
  finishDigest,
  getDb,
  interestFor,
  lastBriefs,
  markReplayEdition,
  type Outcome,
  type Profile,
  previousReplayAsOf,
  previousSentStart,
  type StoryChange,
  saveEditionItems,
  saveJudgments,
  sentEvents,
  storiesByIds,
} from "@digest/db"
import { type JudgeStory, judgeChanges, type Llm, LlmRefusal, SpendCapError, type StoryJudgment } from "@digest/llm"
import { parseChatIds, renderDigestHeader, renderEmptyDigest } from "@digest/telegram"
import { Api } from "grammy"
import { codingStep } from "./coding.ts"
import { storiesStep } from "./hourly/stories.ts"
import { sortEvents } from "./hourly/threads.ts"
import { followedName, interestStep, replayInterest } from "./interest.ts"
import { buildStoryItems, type ItemGroup } from "./items.ts"
import { llmFor } from "./llm.ts"
import { inSteps, sendDelivery } from "./send.ts"
import { log } from "./util.ts"

export type DigestV2Params = {
  /** YYYY-MM-DD (UTC); with the edition it makes the key (editionKey). */
  date: string
  edition: Edition
  /** "send" claims the edition in `digests` and sends it; "replay" writes edition_items with mode replay instead. */
  mode: EditionMode
  /** Unix ms the edition is computed as of: a past edition's send time in a replay; else the instance's start. */
  asOf?: number
  /** A replay only: interest is marked against this profile and never saved. */
  profile?: Profile
}

type Candidates = Awaited<ReturnType<typeof loadCandidates>>
type Mark = { eventId: number; level: number; muted: boolean; reason: string }
type Judgment = typeof editionJudgments.$inferInsert & { outcome: Outcome }
type Planned = ItemGroup & { storyName: string | null; threadId: number | null; gate: number; score: number }

/**
 * Substantial, unsent events counted as of `asOf`, with a member placed since the previous edition of this mode
 * (fetched since, for a replay): the previous sent edition's start for "send", the previous replay's asOf otherwise.
 * Never further back than EDITION.maxLookbackHours. An event also needs a member published since then: `recent`
 * counts those alone, and its title and gist are what the judgment sees, so an event ranks by what is new.
 */
const loadCandidates = async (db: Db, mode: EditionMode, asOf: number) => {
  const previous = mode === "send" ? await previousSentStart(db) : await previousReplayAsOf(db, asOf)
  const since = Math.max(previous ?? asOf - EDITION.windowHours * HOUR_MS, asOf - EDITION.maxLookbackHours * HOUR_MS)
  const changed = await changedEvents(db, since, asOf, mode === "replay" ? "fetched" : "placed")
  const [members, sent] = await Promise.all([eventMembers(db, changed, asOf), sentEvents(db, mode, changed, asOf)])
  const byId = byEvent(members)
  const rows = changed.flatMap((id) => {
    const own = byId.get(id) ?? []
    const counters = sent.has(id) ? null : eventCounters(own)
    const recent = eventCounters(own.filter((m) => m.publishedAt >= since))
    if (!counters || !recent || !isSubstantial(counters)) return []
    return [{ id, lastArticleAt: counters.lastArticleAt, countries: counters.countriesJson, recent }]
  })
  return { since, changed: changed.length, sent: sent.size, rows }
}

/** Code, thread, story and mark the candidates that the hourly loop has not reached yet. */
const prepare = (step: WorkflowStep, db: Db, llm: Llm | null, c: Candidates, p: DigestV2Params) => {
  const eventIds = c.rows.map((r) => r.id)
  return {
    coding: () => step.do("coding", () => codingStep(db, llm, Date.now(), { eventIds })),
    /**
     * Only material events whose significance could reach the bar with the largest boost: an unthreaded one would
     * otherwise go out as storyless. The strongest first, at most THREADS.maxEventsPerRun.
     */
    threads: () =>
      step.do("threads", async () => {
        const codes = await codesFor(db, eventIds)
        const floor = EDITION.minSignificance / Math.max(...INTEREST.boost)
        const worth = [...codes.values()]
          .filter((c) => c.material && c.significance >= floor)
          .sort((a, b) => b.significance - a.significance)
          .slice(0, THREADS.maxEventsPerRun)
          .map((c) => c.eventId)
        return sortEvents(db, llm, Date.now(), { eventIds: worth })
      }),
    stories: () =>
      step.do("stories", async () => {
        const links = await eventThreadLinks(db, eventIds)
        const threadIds = [...new Set([...links.values()].flatMap((l) => l[0]?.threadId ?? []))]
        return storiesStep(db, llm, Date.now(), { threadIds })
      }),
    /** A replay with a profile returns its marks unsaved; otherwise the current profile's marks are saved. */
    interest: () =>
      step.do("interest", async (): Promise<Mark[] | null> => {
        if (p.mode === "replay" && p.profile) {
          return llm ? (await replayInterest(db, llm, p.profile, eventIds)).map(({ callId: _, ...m }) => m) : []
        }
        await interestStep(db, llm, Date.now(), { eventIds })
        return null
      }),
  }
}

/** Haiku judges the stories JUDGE.perCall at a time; a batch that is capped or refused stays unjudged. */
const judgeAll = async (llm: Llm | null, stories: JudgeStory[]) => {
  const out = new Map<number, StoryJudgment>()
  if (!llm) return out
  for (let i = 0; i < stories.length; i += JUDGE.perCall) {
    try {
      for (const j of await judgeChanges(llm, stories.slice(i, i + JUDGE.perCall))) out.set(j.storyId, j)
    } catch (e) {
      if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
      log("edition_change_skipped", { error: String(e) })
      if (e instanceof SpendCapError) break
    }
  }
  return out
}

/**
 * Every candidate's outcome, and the groups that go out, best first. Candidates group by story, else thread, else
 * event. An event counts toward its group's gate when it is coded, material, not muted below EDITION.muteOverride,
 * and its significance times the interest boost reaches EDITION.minSignificance. A storyless group with such an event
 * goes out; a story group goes out only when Haiku judges its change since the reader's last brief major, carried by
 * the events it names. Items rank by gate x corroboration x freshness of their lead.
 */
const compose = async (
  db: Db,
  llm: Llm | null,
  mode: EditionMode,
  key: string,
  asOf: number,
  c: Candidates,
  marks: Mark[] | null,
  profile: Profile,
  version: number,
) => {
  const ids = c.rows.map((r) => r.id)
  const [codes, links, entities, saved] = await Promise.all([
    codesFor(db, ids),
    eventThreadLinks(db, ids),
    eventEntityLinks(db, ids),
    marks ? null : interestFor(db, ids, version),
  ])
  const interest = marks ? new Map(marks.map((m) => [m.eventId, m])) : (saved ?? new Map<number, Mark>())

  const events = c.rows.map((r) => {
    const code = codes.get(r.id) ?? null
    const own = links.get(r.id) ?? []
    const thread = own[0] ?? null
    const mark = interest.get(r.id)
    const followed = followedName(profile.follows, own, entities.get(r.id) ?? [], r.countries)
    const level = Math.max(mark?.level ?? 0, followed ? INTEREST.followLevel : 0)
    const gate = code ? gateOf(code.significance, level) : null
    const outcome: Outcome | null = !code
      ? "uncoded"
      : mark?.muted && !followed && code.significance < EDITION.muteOverride
        ? "muted"
        : !code.material
          ? "talk"
          : (gate ?? 0) < EDITION.minSignificance
            ? "below_bar"
            : null
    const group = thread?.storyId ? `story:${thread.storyId}` : thread ? `thread:${thread.threadId}` : `event:${r.id}`
    return { r, code, thread, level, gate: gate ?? 0, outcome, group, imp: importance(r.recent) }
  })
  type Ev = (typeof events)[number]
  const best = (xs: Ev[]) => xs.toSorted((a, b) => b.gate - a.gate || b.imp - a.imp)[0]

  const groups = new Map<string, Ev[]>()
  for (const e of events) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  const live = [...groups.values()].filter((g) => g.some((e) => e.outcome === null))

  const storyIds = [...new Set(live.flatMap((g) => g[0]?.thread?.storyId ?? []))]
  const [stories, briefs] = await Promise.all([storiesByIds(db, storyIds), lastBriefs(db, mode, storyIds, asOf)])
  const toJudge = storyIds.flatMap((id): JudgeStory[] => {
    const s = stories.get(id)
    const g = groups.get(`story:${id}`) ?? []
    const brief = briefs.get(id)
    if (!s) return []
    const shown = g
      .filter((e) => e.code)
      .sort((a, b) => Number(b.code?.material) - Number(a.code?.material) || b.gate - a.gate)
      .slice(0, JUDGE.eventsPerGroup)
    return [
      {
        id,
        name: s.name,
        description: s.description,
        lastBrief: brief
          ? { headline: brief.headline, summary: brief.summary, ageDays: Math.round((asOf - brief.at) / DAY_MS) }
          : null,
        events: shown.map((e) => ({
          id: e.r.id,
          title: e.r.recent.title,
          gist: e.r.recent.gist,
          act: e.code?.act ?? "other",
          material: e.code?.material ?? false,
          significance: e.code?.significance ?? 0,
        })),
      },
    ]
  })
  const judged = await judgeAll(llm, toJudge)

  const outcomes = new Map<number, { outcome: Outcome; change: StoryChange | null; reason: string | null }>()
  for (const e of events) {
    if (e.outcome) outcomes.set(e.r.id, { outcome: e.outcome, change: null, reason: e.code?.reason ?? null })
  }
  const planned: Planned[] = []
  for (const g of live) {
    const eligible = g.filter((e) => e.outcome === null)
    const storyId = g[0]?.thread?.storyId ?? null
    const j = storyId === null ? null : (judged.get(storyId) ?? null)
    const change = j?.change ?? null
    const lead0 = best(eligible)
    if (!lead0) continue
    if (storyId !== null && !qualifies({ gate: lead0.gate, story: true, change })) {
      const outcome: Outcome = !j ? "not_judged" : change === "minor" ? "minor_change" : "no_change"
      for (const e of eligible) outcomes.set(e.r.id, { outcome, change, reason: j?.reason ?? null })
      continue
    }
    const named = new Set(j?.carriers ?? [])
    const lead = best(eligible.filter((e) => named.has(e.r.id))) ?? lead0
    const carriers = j ? [...new Set([lead.r.id, ...j.carriers])] : eligible.map((e) => e.r.id)
    for (const e of eligible) {
      if (!carriers.includes(e.r.id))
        outcomes.set(e.r.id, { outcome: "not_carried", change, reason: j?.reason ?? null })
    }
    for (const id of carriers) outcomes.set(id, { outcome: "sent", change, reason: j?.reason ?? null })
    const story = storyId === null ? null : (stories.get(storyId) ?? null)
    const brief = storyId === null ? null : (briefs.get(storyId) ?? null)
    planned.push({
      leadId: lead.r.id,
      carriers,
      story,
      storyName: story?.name ?? null,
      threadId: lead.thread?.threadId ?? null,
      lastBrief: brief ? { headline: brief.headline, summary: brief.summary, at: brief.at } : null,
      gate: lead.gate,
      score: itemScore(lead.gate, lead.imp, freshness(lead.r.lastArticleAt, asOf)),
    })
  }
  planned.sort((a, b) => b.score - a.score)

  const judgments: Judgment[] = events.map((e) => {
    const o = outcomes.get(e.r.id) ?? { outcome: "not_carried" as const, change: null, reason: null }
    return {
      editionKey: key,
      mode,
      eventId: e.r.id,
      storyId: e.thread?.storyId ?? null,
      threadId: e.thread?.threadId ?? null,
      significance: e.code?.significance ?? null,
      material: e.code?.material ?? null,
      act: e.code?.act ?? null,
      interest: e.level,
      gate: e.code ? e.gate : null,
      change: o.change,
      outcome: o.outcome,
      reason: o.reason,
      asOf,
    }
  })
  const tally: Record<string, number> = {}
  for (const j of judgments) tally[j.outcome] = (tally[j.outcome] ?? 0) + 1
  log("digest_v2_composed", {
    mode,
    asOf,
    since: c.since,
    changed: c.changed,
    alreadySent: c.sent,
    substantial: c.rows.length,
    groups: groups.size,
    judged: toJudge.length,
    planned: planned.length,
    ...tally,
  })
  return { planned, judgments }
}

/**
 * The digest edition, as of `asOf`: candidates are substantial events with a member placed since the previous
 * edition of the same mode and never sent. They are coded, threaded, put in stories and marked for interest where
 * the hourly loop has not yet, grouped by story, gated on significance and judged for change (compose). Sonnet writes
 * copy for the best EDITION.maxItems + EDITION.copySpare groups, and the first EDITION.maxItems it does not skip as
 * talk go out; fewer, or none, on a quiet day. "send" claims the edition and sends one Telegram message per item with
 * vote buttons; "replay" saves its items and judgments with mode replay, replacing an earlier run's, and writes no
 * copy onto events.
 */
export class DigestV2 extends WorkflowEntrypoint<Env, DigestV2Params> {
  override async run(event: WorkflowEvent<DigestV2Params>, step: WorkflowStep) {
    const p = event.payload
    const { date, edition, mode } = p
    const asOf = p.asOf ?? event.timestamp.getTime()
    const key = editionKey(date, edition)
    const db = getDb(this.env.DB)
    const llm = llmFor(this.env, db)

    if (mode === "send") {
      if (!(await step.do("claim", () => claimDigest(db, key)))) return { skipped: "already claimed" }
    } else {
      await step.do("clear replay", () => clearEdition(db, key, mode))
    }

    const candidates = await step.do("candidates", () => loadCandidates(db, mode, asOf))
    const run = prepare(step, db, llm, candidates, p)
    await run.coding()
    await run.threads()
    await run.stories()
    const marks = await run.interest()

    const composed = await step.do("compose", async () => {
      const current = await currentProfile(db)
      if (!current) {
        log("digest_v2_composed", { mode, asOf, skipped: "no profile" })
        return { planned: [], judgments: [] }
      }
      return compose(db, llm, mode, key, asOf, candidates, marks, p.profile ?? current.profile, current.version)
    })

    const items = await step.do("render", async () => {
      const current = composed.planned.length > 0 ? await currentProfile(db) : null
      if (!current) return []
      const tried = composed.planned.slice(0, EDITION.maxItems + EDITION.copySpare)
      const built = await buildStoryItems(db, llm, p.profile ?? current.profile, tried, asOf, {
        persist: mode === "send",
      })
      return tried.flatMap((g) => {
        const item = built.get(g.leadId)
        return item ? [{ ...g, ...item }] : []
      })
    })
    const kept = items.filter((i) => !i.skip).slice(0, EDITION.maxItems)
    const keptIds = new Set(kept.map((i) => i.leadId))

    const itemIds = await step.do("save", async () => {
      const outcomeOf = new Map<number, Outcome>()
      for (const g of composed.planned) {
        const skipped = items.find((i) => i.leadId === g.leadId)?.skip
        const outcome: Outcome = keptIds.has(g.leadId) ? "sent" : skipped ? "copy_skip" : "over_max"
        for (const id of g.carriers) outcomeOf.set(id, outcome)
      }
      await saveJudgments(
        db,
        composed.judgments.map((j) => ({ ...j, outcome: outcomeOf.get(j.eventId) ?? j.outcome })),
      )
      return saveEditionItems(
        db,
        kept.map((i, n) => ({
          editionKey: key,
          mode,
          rank: n + 1,
          storyId: i.story?.id ?? null,
          threadId: i.threadId,
          leadEventId: i.leadId,
          headline: i.headline,
          summary: i.summary,
          text: i.text,
          isUpdate: i.isUpdate,
          gate: i.gate,
          score: i.score,
          asOf,
          events: i.carriers,
        })),
      )
    })
    const headlines = kept.map((i) => i.headline)

    if (mode === "replay") {
      await step.do("mark replay", () => markReplayEdition(db, key, asOf))
      return { key, mode, items: kept.length, headlines }
    }

    const api = new Api(this.env.TELEGRAM_BOT_TOKEN)
    const chatIds = parseChatIds(this.env.TELEGRAM_CHAT_IDS)
    if (chatIds.length === 0) console.warn("TELEGRAM_CHAT_IDS is empty; nothing to send")
    const send = inSteps(step)

    let sent = 0
    for (const chatId of chatIds) {
      const base = { kind: "digest", digestDate: key, chatId } as const
      if (kept.length === 0) {
        if (await sendDelivery(send, api, db, "empty", renderEmptyDigest(key), base)) sent++
        continue
      }
      await sendDelivery(send, api, db, "header", renderDigestHeader(key, kept.length), base)
      for (const [n, i] of kept.entries()) {
        const delivery = {
          ...base,
          eventId: i.leadId,
          threadId: i.threadId,
          storyId: i.story?.id ?? null,
          editionItemId: itemIds[n] ?? null,
          scoreAtSend: i.score,
          originsAtSend: i.origins,
        }
        if (await sendDelivery(send, api, db, `item ${i.leadId}`, i.text, delivery)) sent++
      }
    }

    await step.do("finish", async () => {
      await finishDigest(db, key, sent > 0 || chatIds.length === 0 ? "sent" : "failed", kept.length, Date.now())
    })
    return { key, mode, sent, items: kept.length, headlines }
  }
}
