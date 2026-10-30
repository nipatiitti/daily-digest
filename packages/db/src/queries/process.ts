import { and, eq, gte, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { articles, type Gate, type GateDecision, gateLog, sources, stories } from "../schema/index.ts"

/** Articles to embed and match, with the source fields matching needs. */
export const articlesToProcess = (db: Db, ids: number[]) =>
  db
    .select({
      id: articles.id,
      sourceId: articles.sourceId,
      title: articles.title,
      snippet: articles.snippet,
      publishedAt: articles.publishedAt,
      storyId: articles.storyId,
      originId: articles.originId,
      category: sources.category,
      tier: sources.tier,
      lang: sources.lang,
      authoritative: sources.authoritative,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(inArray(articles.id, ids))

export type ProcessArticle = Awaited<ReturnType<typeof articlesToProcess>>[number]

/** Where the nearest neighbours already sit. */
export const neighbourAssignments = (db: Db, ids: number[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : db
        .select({
          id: articles.id,
          sourceId: articles.sourceId,
          storyId: articles.storyId,
          originId: articles.originId,
          title: articles.title,
        })
        .from(articles)
        .where(inArray(articles.id, ids))

/** Active stories whose articles mention one of these CVE IDs (the hard key). */
export const storiesWithCves = async (db: Db, cveIds: string[], since: number) => {
  if (cveIds.length === 0) return []
  const rows = await db
    .selectDistinct({ storyId: articles.storyId })
    .from(articles)
    .innerJoin(stories, eq(stories.id, articles.storyId))
    .where(
      and(
        isNotNull(articles.storyId),
        eq(stories.status, "active"),
        gte(articles.publishedAt, since),
        or(...cveIds.map((c) => like(articles.cveIdsJson, `%"${c}"%`))),
      ),
    )
  return rows.flatMap((r) => (r.storyId === null ? [] : [r.storyId]))
}

export const storiesBrief = (db: Db, ids: number[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : db
        .select({
          id: stories.id,
          title: stories.title,
          category: stories.category,
          status: stories.status,
          firstSeen: stories.firstSeen,
        })
        .from(stories)
        .where(inArray(stories.id, ids))

export const createStory = async (
  db: Db,
  s: { category: (typeof stories.$inferInsert)["category"]; title: string; publishedAt: number },
) => {
  const [row] = await db
    .insert(stories)
    .values({ category: s.category, title: s.title, firstSeen: s.publishedAt, lastArticleAt: s.publishedAt })
    .returning({ id: stories.id })
  if (!row) throw new Error("story insert returned no row")
  return row.id
}

export const assignArticle = (
  db: Db,
  id: number,
  a: { storyId: number; originId: number | null; cveIds: string[]; embeddedAt: number },
) =>
  db
    .update(articles)
    .set({ storyId: a.storyId, originId: a.originId, cveIdsJson: a.cveIds, embeddedAt: a.embeddedAt })
    .where(eq(articles.id, id))

/** Recompute a story's counters from its articles (code, never the LLM). */
/**
 * Recompute a story's counters from its articles. With `velocityWindowMinutes`, origins30m (independent origins in
 * that window, read by the alert gate) is written too; without it the column is left for the hourly decay.
 */
export const refreshStoryCounters = async (
  db: Db,
  storyId: number,
  now: number,
  opts?: { velocityWindowMinutes: number },
) => {
  const sixHoursAgo = now - 6 * 3_600_000
  const velocitySince = opts ? now - opts.velocityWindowMinutes * 60_000 : null
  const [agg] = await db
    .select({
      uniqueDomains: sql<number>`count(distinct ${articles.domain})`,
      independentOrigins: sql<number>`sum(case when ${articles.originId} is null then 1 else 0 end)`,
      authoritativeCount: sql<number>`sum(case when ${articles.originId} is null and ${sources.authoritative} then 1 else 0 end)`,
      origins6h: sql<number>`sum(case when ${articles.originId} is null and ${articles.publishedAt} >= ${sixHoursAgo} then 1 else 0 end)`,
      origins30m:
        velocitySince === null
          ? sql<null>`null`
          : sql<number>`sum(case when ${articles.originId} is null and ${articles.publishedAt} >= ${velocitySince} then 1 else 0 end)`,
      finnishSources: sql<number>`sum(case when ${sources.lang} = 'fi' then 1 else 0 end)`,
      firstSeen: sql<number>`min(${articles.publishedAt})`,
      lastArticleAt: sql<number>`max(${articles.publishedAt})`,
      articleIds: sql<string>`group_concat(${articles.id})`,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(eq(articles.storyId, storyId))
  if (!agg?.articleIds) return null
  await db
    .update(stories)
    .set({
      uniqueDomains: agg.uniqueDomains,
      independentOrigins: agg.independentOrigins,
      authoritativeCount: agg.authoritativeCount,
      origins6h: agg.origins6h,
      ...(agg.origins30m === null ? {} : { origins30m: agg.origins30m }),
      firstSeen: agg.firstSeen,
      lastArticleAt: agg.lastArticleAt,
    })
    .where(eq(stories.id, storyId))
  return { ...agg, articleIds: agg.articleIds.split(",").map(Number) }
}

export type StoryCounters = NonNullable<Awaited<ReturnType<typeof refreshStoryCounters>>>

export const getStoryExtractionHash = async (db: Db, storyId: number) => {
  const [row] = await db.select({ hash: stories.extractionHash }).from(stories).where(eq(stories.id, storyId))
  return row?.hash ?? null
}

export const setStoryExtractionHash = (db: Db, storyId: number, hash: string) =>
  db.update(stories).set({ extractionHash: hash }).where(eq(stories.id, storyId))

export const logGate = (
  db: Db,
  g: { storyId: number; gate: Gate; decision: GateDecision; reasons: string[]; shadow: boolean },
) =>
  db
    .insert(gateLog)
    .values({ storyId: g.storyId, gate: g.gate, decision: g.decision, reasonsJson: g.reasons, shadow: g.shadow })

/** Recent articles that never reached a story (pre-process-stage rows, dead-lettered batches). */
export const unassignedRecentArticles = (db: Db, since: number, limit: number) =>
  db
    .select({ id: articles.id })
    .from(articles)
    .where(and(isNull(articles.storyId), gte(articles.publishedAt, since)))
    .orderBy(articles.publishedAt)
    .limit(limit)
