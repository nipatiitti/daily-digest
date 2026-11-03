import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { type Db, selectIn } from "../client.ts"
import { articles, deliveries, digests, facts, sources, stories } from "../schema/index.ts"

const sent = and(eq(digests.status, "sent"), isNotNull(digests.sentAt))

/** When the previous edition of either kind went out; null before the first one. */
export const previousDigestSentAt = async (db: Db) => {
  const [row] = await db
    .select({ sentAt: digests.sentAt })
    .from(digests)
    .where(sent)
    .orderBy(desc(digests.sentAt))
    .limit(1)
  return row?.sentAt ?? null
}

/** The stories among `storyIds` whose origin articles all come from advisory sources. */
export const advisoryOnlyStories = async (db: Db, storyIds: number[]) => {
  const rows = await selectIn(db, storyIds, 2, (chunk) =>
    db
      .select({ storyId: articles.storyId })
      .from(articles)
      .innerJoin(sources, eq(sources.id, articles.sourceId))
      .where(and(inArray(articles.storyId, chunk), isNull(articles.originId)))
      .groupBy(articles.storyId)
      .having(sql`min(${sources.role} = 'advisory') = 1`),
  )
  return new Set(rows.flatMap((r) => (r.storyId === null ? [] : [r.storyId])))
}

/** The extraction's entity names per story, as flagStoryArticles wrote them on its articles. */
export const storyEntityNames = async (db: Db, storyIds: number[]) => {
  const rows = await selectIn(db, storyIds, 2, (chunk) =>
    db
      .selectDistinct({ storyId: articles.storyId, entities: articles.entitiesJson })
      .from(articles)
      .where(and(inArray(articles.storyId, chunk), isNotNull(articles.entitiesJson))),
  )
  const out = new Map<number, string[]>()
  for (const r of rows) {
    if (r.storyId !== null) out.set(r.storyId, [...(out.get(r.storyId) ?? []), ...(r.entities ?? [])])
  }
  return out
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
