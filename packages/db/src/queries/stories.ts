import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm"
import { type Db, runBatch, selectIn } from "../client.ts"
import { events, eventThreads, type Story, stories, threads } from "../schema/index.ts"

/** Rows read per statement: keeps D1 result sets small. */
const PAGE = 200

/** Active stories, and closed ones with an article since `closedSince`, which a joining thread reopens. */
const joinable = (closedSince: number) =>
  or(eq(stories.status, "active"), and(eq(stories.status, "closed"), gte(stories.lastSeen, closedSince)))

const threadRow = {
  id: threads.id,
  name: threads.name,
  description: threads.description,
  centroid: threads.centroid,
  eventCount: threads.eventCount,
  firstSeen: threads.firstSeen,
  lastSeen: threads.lastSeen,
  storyId: threads.storyId,
}

/**
 * Unmerged threads whose story is due: never checked, or storyless with `recheckFactor` times the events it had when
 * checked. Either those with an article since `since`, latest first, at most `limit`, or the given ones.
 */
export const storyDueThreads = (
  db: Db,
  o: { recheckFactor: number } & ({ since: number; limit: number } | { threadIds: number[] }),
) => {
  const due = and(
    ne(threads.status, "merged"),
    or(
      isNull(threads.storyCheckedAt),
      and(isNull(threads.storyId), gte(threads.eventCount, sql`${o.recheckFactor} * ${threads.storyCheckedEvents}`)),
    ),
  )
  if ("threadIds" in o) {
    return selectIn(db, o.threadIds, 1, (chunk) =>
      db
        .select(threadRow)
        .from(threads)
        .where(and(due, inArray(threads.id, chunk))),
    )
  }
  return db
    .select(threadRow)
    .from(threads)
    .where(and(due, gte(threads.lastSeen, o.since)))
    .orderBy(desc(threads.lastSeen), desc(threads.id))
    .limit(o.limit)
}

export type StoryDueThread = Awaited<ReturnType<typeof storyDueThreads>>[number]

/** Every joinable story with its centroid, read in pages of PAGE by id. */
export const joinableStories = async (db: Db, closedSince: number) => {
  const out: Pick<Story, "id" | "name" | "description" | "status" | "centroid" | "threadCount">[] = []
  for (let after = 0; ; ) {
    const page = await db
      .select({
        id: stories.id,
        name: stories.name,
        description: stories.description,
        status: stories.status,
        centroid: stories.centroid,
        threadCount: stories.threadCount,
      })
      .from(stories)
      .where(and(joinable(closedSince), gt(stories.id, after)))
      .orderBy(stories.id)
      .limit(PAGE)
    out.push(...page)
    const last = page.at(-1)
    if (page.length < PAGE || !last) return out
    after = last.id
  }
}

/** The story of each given thread that has one. */
export const threadStories = async (db: Db, threadIds: number[]) =>
  new Map(
    (
      await selectIn(db, threadIds, 1, (chunk) =>
        db
          .select({ id: threads.id, storyId: threads.storyId })
          .from(threads)
          .where(and(inArray(threads.id, chunk), sql`${threads.storyId} is not null`)),
      )
    ).map((r) => [r.id, r.storyId as number]),
  )

/** Up to `perThread` of each thread's latest unmerged events, latest first, by thread id. */
export const threadLatestEvents = async (db: Db, threadIds: number[], perThread: number) => {
  const rows = await selectIn(db, threadIds, 2, (ids) => {
    const ranked = db
      .select({
        threadId: eventThreads.threadId,
        eventId: events.id,
        title: events.title,
        rank: sql<number>`row_number() over (partition by ${eventThreads.threadId}
          order by ${events.lastArticleAt} desc, ${events.id} desc)`.as("rank"),
      })
      .from(eventThreads)
      .innerJoin(events, eq(events.id, eventThreads.eventId))
      .where(and(inArray(eventThreads.threadId, ids), ne(events.status, "merged")))
      .as("ranked")
    return db
      .select({ threadId: ranked.threadId, eventId: ranked.eventId, title: ranked.title })
      .from(ranked)
      .where(lte(ranked.rank, perThread))
      .orderBy(ranked.threadId, sql`${ranked.rank}`)
  })
  const out = new Map<number, { eventId: number; title: string }[]>()
  for (const r of rows) out.set(r.threadId, [...(out.get(r.threadId) ?? []), r])
  return out
}

/** Up to `perStory` names of each story's latest unmerged threads, by story id. */
export const storyExamples = async (db: Db, storyIds: number[], perStory: number) => {
  const rows = await selectIn(db, storyIds, 2, (ids) => {
    const ranked = db
      .select({
        storyId: threads.storyId,
        name: threads.name,
        rank: sql<number>`row_number() over (partition by ${threads.storyId} order by ${threads.lastSeen} desc)`.as(
          "rank",
        ),
      })
      .from(threads)
      .where(and(inArray(threads.storyId, ids), ne(threads.status, "merged")))
      .as("ranked")
    return db
      .select({ storyId: ranked.storyId, name: ranked.name })
      .from(ranked)
      .where(lte(ranked.rank, perStory))
      .orderBy(ranked.storyId, sql`${ranked.rank}`)
  })
  const out = new Map<number, string[]>()
  for (const r of rows) if (r.storyId !== null) out.set(r.storyId, [...(out.get(r.storyId) ?? []), r.name])
  return out
}

type Check = { threadId: number; at: number; events: number }

const checked = (c: Check) => ({ storyCheckedAt: c.at, storyCheckedEvents: c.events })

const threadCountSql = sql`(select count(*) from ${threads} where ${threads.storyId} = ${stories.id}
  and ${threads.status} != 'merged')`

/** A story founded by one thread, and the thread put in it, in one batch. Returns the story id. */
export const createStory = async (
  db: Db,
  s: Check & { name: string; description: string; centroid: Float32Array; firstSeen: number; lastSeen: number },
) => {
  // The batch is one transaction and ids autoincrement, so the newest id is the story just inserted.
  const [[created]] = (await runBatch(db, [
    db
      .insert(stories)
      .values({
        name: s.name,
        description: s.description,
        centroid: s.centroid,
        firstSeen: s.firstSeen,
        lastSeen: s.lastSeen,
        threadCount: 1,
        createdAt: s.at,
      })
      .returning({ id: stories.id }),
    db
      .update(threads)
      .set({ storyId: sql<number>`(select max(${stories.id}) from ${stories})`, ...checked(s) })
      .where(eq(threads.id, s.threadId)),
  ])) as [{ id: number }[]]
  if (!created) throw new Error("Story insert returned no row")
  return created.id
}

/**
 * Put a thread in a story with the story's new centroid (the caller's running mean), recount its threads, move
 * `lastSeen` and reopen it when closed.
 */
export const assignStory = (db: Db, a: Check & { storyId: number; centroid: Float32Array; lastSeen: number }) =>
  runBatch(db, [
    db
      .update(threads)
      .set({ storyId: a.storyId, ...checked(a) })
      .where(eq(threads.id, a.threadId)),
    db
      .update(stories)
      .set({
        centroid: a.centroid,
        threadCount: threadCountSql,
        lastSeen: sql`max(${stories.lastSeen}, ${a.lastSeen})`,
        status: sql`case when ${stories.status} = 'closed' then 'active' else ${stories.status} end`,
      })
      .where(eq(stories.id, a.storyId)),
  ])

/** A thread the model kept out of every story: asked again once it grows. */
export const markStoryChecked = (db: Db, c: Check) =>
  db.update(threads).set(checked(c)).where(eq(threads.id, c.threadId))

/** Recount active stories' threads and latest article, then close those quiet since `quietSince`. Returns the count. */
export const storyLifecycle = async (db: Db, o: { quietSince: number }) => {
  const [, closed] = (await runBatch(db, [
    db
      .update(stories)
      .set({
        threadCount: threadCountSql,
        lastSeen: sql`max(${stories.lastSeen}, coalesce((select max(${threads.lastSeen}) from ${threads}
          where ${threads.storyId} = ${stories.id} and ${threads.status} != 'merged'), 0))`,
      })
      .where(eq(stories.status, "active")),
    db
      .update(stories)
      .set({ status: "closed" })
      .where(and(eq(stories.status, "active"), lt(stories.lastSeen, o.quietSince)))
      .returning({ id: stories.id }),
  ])) as [unknown, unknown[]]
  return { closed: closed.length }
}

/** The given stories' names and descriptions, by id. */
export const storiesByIds = async (db: Db, ids: number[]) =>
  new Map(
    (
      await selectIn(db, ids, 1, (chunk) =>
        db
          .select({ id: stories.id, name: stories.name, description: stories.description })
          .from(stories)
          .where(inArray(stories.id, chunk)),
      )
    ).map((r) => [r.id, r]),
  )
