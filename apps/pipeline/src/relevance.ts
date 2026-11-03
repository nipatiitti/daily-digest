import { countryName, HOUR_MS, isSubstantial, RELEVANCE } from "@digest/core"
import {
  byEvent,
  currentProfile,
  type Db,
  eventEntityLinks,
  eventMembers,
  eventThreadLinks,
  type Profile,
  type ProfileFollows,
  relevanceTargets,
  saveRelevance,
} from "@digest/db"
import { type Llm, LlmRefusal, type RelevanceEvent, SpendCapError, scoreRelevance } from "@digest/llm"
import { overSoftCap } from "./llm.ts"
import { log } from "./util.ts"

/** The followed thread, entity or country an event touches, by name, in that order; null when none. */
export const followedName = (
  follows: ProfileFollows,
  threads: { threadId: number; name: string }[],
  entities: { key: string; name: string }[],
  countries: string[],
) => {
  const country = countries.find((c) => follows.countries.includes(c))
  return (
    threads.find((t) => follows.threads.includes(t.threadId))?.name ??
    entities.find((e) => follows.entities.includes(e.key))?.name ??
    (country ? countryName(country) : null)
  )
}

/** What an event is scored from; threads, entities and follows are looked up as they are now. */
export type Scorable = Omit<RelevanceEvent, "threadName" | "entities" | "followed">

/**
 * Haiku scores the events against the profile, RELEVANCE.perCall per call, without saving: a refused call skips its
 * events, the spend cap stops the run.
 */
export const scoreEvents = async (db: Db, llm: Llm, profile: Profile, events: Scorable[]) => {
  const ids = events.map((e) => e.id)
  const [threads, entities] = await Promise.all([eventThreadLinks(db, ids), eventEntityLinks(db, ids)])
  const asked = (e: Scorable): RelevanceEvent => {
    const own = { threads: threads.get(e.id) ?? [], entities: entities.get(e.id) ?? [] }
    return {
      ...e,
      threadName: own.threads[0]?.name ?? null,
      entities: own.entities.slice(0, RELEVANCE.entitiesPerEvent).map((x) => x.name),
      followed: followedName(profile.follows, own.threads, own.entities, e.countries),
    }
  }
  const out = { scores: [] as { eventId: number; score: number; reason: string; callId: number | null }[], refused: 0 }
  for (let i = 0; i < events.length; i += RELEVANCE.perCall) {
    const batch = events.slice(i, i + RELEVANCE.perCall)
    try {
      const { scores, callId } = await scoreRelevance(llm, profile, batch.map(asked))
      out.scores.push(...scores.map((s) => ({ ...s, callId })))
    } catch (e) {
      if (e instanceof SpendCapError) return { ...out, capped: 1 }
      if (!(e instanceof LlmRefusal)) throw e
      out.refused += batch.length
    }
  }
  return { ...out, capped: 0 }
}

/**
 * Scores and saves events against the current profile: hourly the active, substantial events with an article in the
 * last RELEVANCE.recentHours, or the given events (the digest's candidates). Only events with no score for the
 * current version, or whose origins reached RELEVANCE.rescoreOriginsFactor times those at the last score, are asked,
 * latest article first, at most RELEVANCE.maxPerRun. The spend soft cap holds the hourly run only.
 */
export const relevanceStep = async (
  db: Db,
  llm: Llm | null,
  now: number,
  o: { eventIds?: number[] } = {},
): Promise<Record<string, number>> => {
  const current = llm ? await currentProfile(db) : null
  if (!llm || !current) {
    log("relevance_skipped", { reason: llm ? "no profile" : "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const over = o.eventIds ? null : await overSoftCap(llm)
  if (over) {
    log("relevance_skipped", over)
    return { skipped: 1 }
  }
  const targets = await relevanceTargets(
    db,
    current.version,
    RELEVANCE.rescoreOriginsFactor,
    o.eventIds ? { eventIds: o.eventIds } : { since: now - RELEVANCE.recentHours * HOUR_MS },
  )
  const due = targets
    .filter((e) => o.eventIds || isSubstantial(e))
    .sort((a, b) => b.lastArticleAt - a.lastArticleAt)
    .slice(0, RELEVANCE.maxPerRun)
  if (due.length === 0) return { due: 0 }

  const ids = due.map((e) => e.id)
  const members = byEvent(await eventMembers(db, ids))
  const { scores, refused, capped } = await scoreEvents(
    db,
    llm,
    current.profile,
    due.map((e) => ({
      id: e.id,
      title: e.title,
      gist: e.gist,
      countries: e.countries,
      eventType: e.eventType,
      advisoryOnly: e.advisoryOnly,
      sources: [...new Set((members.get(e.id) ?? []).map((m) => m.sourceName))],
    })),
  )
  const origins = new Map(due.map((e) => [e.id, e.independentOrigins]))
  await saveRelevance(
    db,
    scores.map((s) => ({
      eventId: s.eventId,
      profileVersion: current.version,
      score: s.score,
      reason: s.reason,
      originsAtScore: origins.get(s.eventId) ?? 0,
      llmCallId: s.callId,
      at: now,
    })),
  )
  return { due: due.length, scored: scores.length, refused, capped }
}
