import { countryName, HOUR_MS, INTEREST, SUBSTANTIAL } from "@digest/core"
import {
  currentProfile,
  type Db,
  eventEntityLinks,
  eventThreadLinks,
  type InterestTarget,
  interestTargets,
  type Profile,
  type ProfileFollows,
  saveInterest,
} from "@digest/db"
import { type Llm, LlmRefusal, SpendCapError, scoreInterest } from "@digest/llm"
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

type Mark = { eventId: number; level: number; muted: boolean; reason: string; callId: number | null }

/**
 * Haiku marks the events against the profile, INTEREST.perCall per call, without saving: a refused call skips its
 * events, the spend cap stops the run.
 */
export const markEvents = async (db: Db, llm: Llm, profile: Profile, events: InterestTarget[]) => {
  const ids = events.map((e) => e.id)
  const [threads, entities] = await Promise.all([eventThreadLinks(db, ids), eventEntityLinks(db, ids)])
  const out = { marks: [] as Mark[], refused: 0, capped: 0 }
  for (let i = 0; i < events.length; i += INTEREST.perCall) {
    const batch = events.slice(i, i + INTEREST.perCall)
    try {
      const { marks, callId } = await scoreInterest(
        llm,
        profile,
        batch.map((e) => ({
          id: e.id,
          title: e.title,
          gist: e.gist,
          countries: e.countries,
          eventType: e.eventType,
          threadName: threads.get(e.id)?.[0]?.name ?? null,
          entities: (entities.get(e.id) ?? []).slice(0, INTEREST.entitiesPerEvent).map((x) => x.name),
        })),
      )
      out.marks.push(...marks.map((m) => ({ ...m, callId })))
    } catch (e) {
      if (e instanceof SpendCapError) return { ...out, capped: 1 }
      if (!(e instanceof LlmRefusal)) throw e
      out.refused += batch.length
    }
  }
  return out
}

const targets = (db: Db, version: number, o: { since: number } | { eventIds: number[] }) =>
  interestTargets(db, {
    version,
    factor: INTEREST.rescoreOriginsFactor,
    minOrigins: SUBSTANTIAL.minOrigins,
    minOfficial: SUBSTANTIAL.minOfficial,
    ...o,
  })

/**
 * Marks and saves events against the current profile: hourly the active, substantial events with an article in the
 * last INTEREST.recentHours, or the given events (the edition's candidates). Only events with no mark for the current
 * version, or whose origins doubled since, are asked, latest article first, at most INTEREST.maxPerRun. The spend
 * soft cap holds the hourly run only.
 */
export const interestStep = async (
  db: Db,
  llm: Llm | null,
  now: number,
  o: { eventIds?: number[] } = {},
): Promise<Record<string, number>> => {
  const current = llm ? await currentProfile(db) : null
  if (!llm || !current) {
    log("interest_skipped", { reason: llm ? "no profile" : "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const over = o.eventIds ? null : await overSoftCap(llm)
  if (over) {
    log("interest_skipped", over)
    return { skipped: 1 }
  }
  const due = (
    await targets(
      db,
      current.version,
      o.eventIds ? { eventIds: o.eventIds } : { since: now - INTEREST.recentHours * HOUR_MS },
    )
  )
    .sort((a, b) => b.lastArticleAt - a.lastArticleAt)
    .slice(0, INTEREST.maxPerRun)
  if (due.length === 0) return { due: 0 }
  const { marks, refused, capped } = await markEvents(db, llm, current.profile, due)
  const origins = new Map(due.map((e) => [e.id, e.independentOrigins]))
  await saveInterest(
    db,
    marks.map((m) => ({
      eventId: m.eventId,
      profileVersion: current.version,
      level: m.level,
      muted: m.muted,
      reason: m.reason,
      originsAtScore: origins.get(m.eventId) ?? 0,
      llmCallId: m.callId,
      at: now,
    })),
  )
  return { due: due.length, marked: marks.length, refused, capped }
}

/** A replay's marks: the given events against `profile`, never saved. */
export const replayInterest = async (db: Db, llm: Llm, profile: Profile, eventIds: number[]) =>
  (await markEvents(db, llm, profile, await targets(db, -1, { eventIds }))).marks
