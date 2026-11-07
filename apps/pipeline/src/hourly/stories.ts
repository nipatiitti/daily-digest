import { DAY_MS, nearestThreads, pickThreadCandidates, STORIES, THREADS, weightedMean } from "@digest/core"
import {
  assignStory,
  createStory,
  type Db,
  joinableStories,
  markStoryChecked,
  type StoryDueThread,
  storyDueThreads,
  storyExamples,
  storyLifecycle,
  threadLatestEvents,
  threadStories,
  threadsSharingEntities,
} from "@digest/db"
import { decideStory, type Llm, nameStory, SpendCapError, type StoryThread } from "@digest/llm"
import { overSoftCap } from "../llm.ts"
import { log } from "../util.ts"

type How = "join" | "new" | "merge" | "none" | "error"
type Joinable = Awaited<ReturnType<typeof joinableStories>>[number]

/**
 * Put threads into stories, then recount stories and close quiet ones. Hourly the due threads with an article in the
 * last STORIES.backfillDays, at most STORIES.maxThreadsPerRun, under the spend soft cap; the edition passes its
 * candidates' threads instead, and the soft cap does not hold it. The lifecycle runs even when the sorting skips.
 */
export const storiesStep = async (db: Db, llm: Llm | null, now: number, o: { threadIds?: number[] } = {}) => {
  const counts = await sortThreads(db, llm, now, o.threadIds)
  if (o.threadIds) return counts
  const lifecycle = await storyLifecycle(db, { quietSince: now - STORIES.closeAfterDays * DAY_MS })
  return { ...counts, ...lifecycle }
}

const sortThreads = async (db: Db, llm: Llm | null, now: number, threadIds?: number[]) => {
  if (!llm) {
    log("stories_skipped", { reason: "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const over = threadIds ? null : await overSoftCap(llm)
  if (over) {
    log("stories_skipped", over)
    return { skipped: 1 }
  }
  const due = await storyDueThreads(
    db,
    threadIds
      ? { recheckFactor: STORIES.recheckFactor, threadIds }
      : {
          recheckFactor: STORIES.recheckFactor,
          since: now - STORIES.backfillDays * DAY_MS,
          limit: STORIES.maxThreadsPerRun,
        },
  )
  if (due.length === 0) return { threads: 0 }
  const closedSince = now - STORIES.reopenDays * DAY_MS
  const live = new Map((await joinableStories(db, closedSince)).map((s) => [s.id, s]))
  const latest = await threadLatestEvents(
    db,
    due.map((t) => t.id),
    Math.max(STORIES.titlesPerThread, STORIES.entityEvents),
  )
  const tally: Record<How, number> = { join: 0, new: 0, merge: 0, none: 0, error: 0 }
  for (const t of due) {
    try {
      const { how, storyId } = await sortThread(db, llm, t, latest.get(t.id) ?? [], live, now)
      tally[how]++
      log("story", { how, threadId: t.id, storyId })
    } catch (e) {
      tally.error++
      log("story", { how: "error", threadId: t.id, storyId: null, error: String(e) })
      if (e instanceof SpendCapError) break
    }
  }
  return { threads: due.length, ...tally }
}

/**
 * Candidates are the stories of threads whose events share entities with the thread's latest events, plus the
 * joinable stories nearest its centroid. Haiku joins one, proposes one or answers none; Sonnet creates the proposal
 * or merges it into a near story. A thread that fails stays due and is offered again next run.
 */
const sortThread = async (
  db: Db,
  llm: Llm,
  t: StoryDueThread,
  latest: { eventId: number; title: string }[],
  live: Map<number, Joinable>,
  now: number,
): Promise<{ how: Exclude<How, "error">; storyId: number | null }> => {
  const closedSince = now - THREADS.reopenDays * DAY_MS
  const sharing = (
    await Promise.all(
      latest.slice(0, STORIES.entityEvents).map((e) =>
        threadsSharingEntities(db, e.eventId, {
          min: STORIES.sharedEntitiesMin,
          limit: THREADS.maxCandidates,
          closedSince,
        }),
      ),
    )
  )
    .flat()
    .filter((s) => s.id !== t.id)
  const storyOf = await threadStories(db, [...new Set(sharing.map((s) => s.id))])
  const shared = new Map<number, number>()
  for (const s of sharing) {
    const story = storyOf.get(s.id)
    if (story !== undefined && live.has(story)) shared.set(story, Math.max(shared.get(story) ?? 0, s.shared))
  }
  const nearest = nearestThreads(t.centroid, [...live.values()], STORIES.nearestK)
  const candidates = pickThreadCandidates({
    sharedEntities: [...shared].map(([id, n]) => ({ id, shared: n })),
    nearest,
    limit: STORIES.maxCandidates,
  })
  const naming = nearest.slice(0, STORIES.namingNearest)
  const examples = await storyExamples(
    db,
    [...new Set([...candidates, ...naming].map((c) => c.id))],
    STORIES.examplesPerCandidate,
  )
  const inputs = (cs: { id: number }[]) =>
    cs.flatMap((c) => {
      const s = live.get(c.id)
      return s ? [{ id: s.id, name: s.name, description: s.description, examples: examples.get(s.id) ?? [] }] : []
    })
  const check = { threadId: t.id, at: now, events: t.eventCount }
  const join = async (how: "join" | "merge", storyId: number) => {
    const s = live.get(storyId)
    if (!s) throw new Error(`Story ${storyId} is not joinable`)
    const centroid = weightedMean([
      { v: s.centroid, n: s.threadCount },
      { v: t.centroid, n: 1 },
    ])
    await assignStory(db, { ...check, storyId, centroid, lastSeen: t.lastSeen })
    live.set(storyId, { ...s, centroid, threadCount: s.threadCount + 1, status: "active" })
    return { how, storyId }
  }

  const thread: StoryThread = {
    id: t.id,
    name: t.name,
    description: t.description,
    titles: latest.slice(0, STORIES.titlesPerThread).map((e) => e.title),
  }
  const decision = await decideStory(llm, thread, inputs(candidates))
  if (decision.decision === "none") {
    await markStoryChecked(db, check)
    return { how: "none", storyId: null }
  }
  if (decision.decision === "join") return join("join", decision.storyId)
  const { proposedName, proposedDescription } = decision
  const named = await nameStory(llm, { proposedName, proposedDescription, thread }, inputs(naming))
  if (named.action === "merge") return join("merge", named.intoStoryId)
  const { name, description } = named
  const storyId = await createStory(db, {
    ...check,
    name,
    description,
    centroid: t.centroid,
    firstSeen: t.firstSeen,
    lastSeen: t.lastSeen,
  })
  // Later threads in this run can join it.
  live.set(storyId, { id: storyId, name, description, status: "active", centroid: t.centroid, threadCount: 1 })
  return { how: "new", storyId }
}
