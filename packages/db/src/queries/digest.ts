import { and, desc, eq, gt, gte, inArray, isNotNull, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { articles, deliveries, digests, facts, stories } from "../schema/index.ts"

/** When the previous edition of either kind went out; null before the first one. */
export const previousDigestSentAt = async (db: Db) => {
  const [row] = await db
    .select({ sentAt: digests.sentAt })
    .from(digests)
    .where(and(eq(digests.status, "sent"), isNotNull(digests.sentAt)))
    .orderBy(desc(digests.sentAt))
    .limit(1)
  return row?.sentAt ?? null
}

/** Scored, active stories that changed since `since`. */
export const changedStories = (db: Db, since: number) =>
  db
    .select()
    .from(stories)
    .where(and(eq(stories.status, "active"), isNotNull(stories.score), gte(stories.lastArticleAt, since)))
    .orderBy(desc(stories.score))

/** Latest delivery per story; the digest never sends a story that has one. */
export const latestDeliveries = async (db: Db, storyIds: number[]) => {
  if (storyIds.length === 0) return new Map<number, { sentAt: number; scoreAtSend: number | null }>()
  const rows = await db
    .select({
      storyId: deliveries.storyId,
      sentAt: sql<number>`max(${deliveries.sentAt})`,
      scoreAtSend: sql<number | null>`${deliveries.scoreAtSend}`,
    })
    .from(deliveries)
    .where(inArray(deliveries.storyId, storyIds))
    .groupBy(deliveries.storyId)
  return new Map(
    rows.flatMap((r) =>
      r.storyId === null ? [] : [[r.storyId, { sentAt: r.sentAt, scoreAtSend: r.scoreAtSend }] as const],
    ),
  )
}

/** Active facts per story that appeared after `since`, newest first. */
export const factsAfter = async (db: Db, storyIds: number[], since: number) => {
  if (storyIds.length === 0) return []
  return db
    .select()
    .from(facts)
    .where(and(inArray(facts.storyId, storyIds), eq(facts.status, "active"), gt(facts.firstSeen, since)))
    .orderBy(desc(facts.salience))
}

export const activeFactIds = async (db: Db, storyId: number) =>
  (
    await db
      .select({ id: facts.id })
      .from(facts)
      .where(and(eq(facts.storyId, storyId), eq(facts.status, "active")))
  ).map((r) => r.id)

/** Source of each story's earliest origin article; the digest allows two items per source. */
export const mainSources = async (db: Db, storyIds: number[]) => {
  if (storyIds.length === 0) return new Map<number, number>()
  const rows = await db
    .select({ storyId: articles.storyId, sourceId: articles.sourceId, publishedAt: articles.publishedAt })
    .from(articles)
    .where(inArray(articles.storyId, storyIds))
    .orderBy(articles.publishedAt)
  const out = new Map<number, number>()
  for (const r of rows) if (r.storyId !== null && !out.has(r.storyId)) out.set(r.storyId, r.sourceId)
  return out
}
