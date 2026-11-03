import { DAY_MS, isSubstantial, nearestThreads, pickThreadCandidates, THREADS, weightedMean } from "@digest/core"
import {
  createThread,
  type Db,
  joinableThreads,
  linkEventThread,
  type ThreadingEvent,
  threadExamples,
  threadingEvents,
  threadLifecycle,
  threadsSharingEntities,
  unthreadedEvents,
} from "@digest/db"
import { decideThread, type Llm, MODELS, nameThread, SpendCapError, type ThreadEvent } from "@digest/llm"
import { overSoftCap } from "../llm.ts"
import { log } from "../util.ts"

type How = "join" | "new" | "merge" | "error"
type Joinable = Awaited<ReturnType<typeof joinableThreads>>[number]

/**
 * Sort substantial events into threads, then promote provisional threads with enough events and close quiet ones.
 * The lifecycle costs nothing, so it runs even when spend or a missing key skips the sorting.
 */
export const threadsStep = async (db: Db, llm: Llm | null, now: number) => {
  const counts = await sortEvents(db, llm, now)
  const lifecycle = await threadLifecycle(db, {
    visibleEvents: THREADS.visibleEvents,
    quietSince: now - THREADS.closeAfterDays * DAY_MS,
  })
  return { ...counts, ...lifecycle }
}

/** Active, substantial events with no thread, first seen within the backfill window, oldest first. */
const eligibleEvents = async (db: Db, now: number) => {
  const ids: number[] = []
  let cursor = { firstSeen: now - THREADS.backfillDays * DAY_MS, id: 0 }
  while (ids.length < THREADS.maxEventsPerRun) {
    const page = await unthreadedEvents(db, cursor)
    ids.push(...page.filter((e) => isSubstantial(e)).map((e) => e.id))
    const last = page.at(-1)
    if (!last) break
    cursor = last
  }
  return ids.slice(0, THREADS.maxEventsPerRun)
}

/**
 * Candidates are threads sharing entities with the event plus the joinable threads nearest its centroid. Haiku joins
 * one or proposes a thread; Sonnet creates the proposal or merges it into a near thread. An event that fails stays
 * unthreaded and is offered again next run.
 */
const sortEvents = async (db: Db, llm: Llm | null, now: number) => {
  if (!llm) {
    log("threads_skipped", { reason: "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const over = await overSoftCap(llm)
  if (over) {
    log("threads_skipped", over)
    return { skipped: 1 }
  }

  const events = await threadingEvents(db, await eligibleEvents(db, now), THREADS.entitiesPerEvent)
  const closedSince = now - THREADS.reopenDays * DAY_MS
  const live = new Map((events.length ? await joinableThreads(db, closedSince) : []).map((t) => [t.id, t]))
  const tally: Record<How, number> = { join: 0, new: 0, merge: 0, error: 0 }
  for (const event of events) {
    try {
      const { how, threadId } = await sortEvent(db, llm, event, live, closedSince, now)
      tally[how]++
      log("thread", { how, eventId: event.id, threadId })
    } catch (e) {
      tally.error++
      log("thread", { how: "error", eventId: event.id, threadId: null, error: String(e) })
      if (e instanceof SpendCapError) break
    }
  }
  return { events: events.length, ...tally }
}

const sortEvent = async (
  db: Db,
  llm: Llm,
  e: ThreadingEvent,
  live: Map<number, Joinable>,
  closedSince: number,
  now: number,
): Promise<{ how: Exclude<How, "error">; threadId: number }> => {
  const shared = await threadsSharingEntities(db, e.id, {
    min: THREADS.sharedEntitiesMin,
    limit: THREADS.maxCandidates,
    closedSince,
  })
  const nearest = nearestThreads(e.centroid, [...live.values()], THREADS.nearestK)
  const candidates = pickThreadCandidates({ sharedEntities: shared, nearest, limit: THREADS.maxCandidates })
  const naming = nearest.slice(0, THREADS.namingNearest)
  const examples = await threadExamples(
    db,
    [...new Set([...candidates, ...naming].map((c) => c.id))],
    THREADS.examplesPerCandidate,
  )
  const inputs = (cs: { id: number }[]) =>
    cs.flatMap((c) => {
      const t = live.get(c.id)
      return t ? [{ id: t.id, name: t.name, description: t.description, examples: examples.get(t.id) ?? [] }] : []
    })
  const join = async (how: "join" | "merge", threadId: number, confidence: number, by: string) => {
    const t = live.get(threadId)
    if (!t) throw new Error(`Thread ${threadId} is not joinable`)
    const centroid = weightedMean([
      { v: t.centroid, n: t.eventCount },
      { v: e.centroid, n: 1 },
    ])
    await linkEventThread(db, { eventId: e.id, threadId, confidence, by, at: now, centroid, lastSeen: e.lastArticleAt })
    const status = t.status === "closed" ? "active" : t.status
    live.set(threadId, { ...t, centroid, eventCount: t.eventCount + 1, status })
    return { how, threadId }
  }

  const event: ThreadEvent = { id: e.id, title: e.title, gist: e.gist, entities: e.entities, countries: e.countries }
  const decision = await decideThread(llm, event, inputs(candidates))
  if (decision.decision === "join") return join("join", decision.threadId, decision.confidence, MODELS.haiku)
  const { proposedName, proposedDescription } = decision
  const named = await nameThread(llm, { proposedName, proposedDescription, event }, inputs(naming))
  if (named.action === "merge") return join("merge", named.intoThreadId, 1, MODELS.sonnet)
  const { name, description } = named
  const threadId = await createThread(db, {
    name,
    description,
    centroid: e.centroid,
    firstSeen: e.firstSeen,
    lastSeen: e.lastArticleAt,
    eventId: e.id,
    confidence: 1,
    by: MODELS.sonnet,
    at: now,
  })
  // Later events in this run can join it.
  live.set(threadId, { id: threadId, name, description, status: "provisional", centroid: e.centroid, eventCount: 1 })
  return { how: "new", threadId }
}
