import {
  and,
  type Column,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  sql,
} from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  actions,
  articles,
  dbStats,
  deliveries,
  facts,
  feedback,
  follows,
  gateLog,
  llmCalls,
  matchLog,
  type RollupKind,
  rollups,
  signals,
  sources,
  stories,
  storyVulns,
  vulns,
} from "../schema/index.ts"
import { spendSince } from "./ops.ts"
import { storyArticles } from "./stories.ts"

/** The three header lamps: newest fetched item, stories waiting for a score, Claude spend since UTC midnight. */
export const lampInputs = async (db: Db, now: number) => {
  const [[newest], [backlog], spendTodayUsd] = await Promise.all([
    db.select({ at: sql<number | null>`max(${sources.lastNewItemAt})` }).from(sources),
    db
      .select({ n: sql<number>`count(*)` })
      .from(stories)
      .where(and(eq(stories.status, "active"), isNotNull(stories.extractionHash), isNull(stories.score))),
    spendSince(db, now - (now % 86_400_000)),
  ])
  return {
    minutesSinceNewItem: newest?.at == null ? null : Math.floor((now - newest.at) / 60_000),
    evalBacklog: backlog?.n ?? 0,
    spendTodayUsd,
  }
}

/** Index of `at` when [from, to) is cut into `slices` equal parts; cast so a real-bound parameter still floors. */
const sliceOf = (at: Column, from: number, to: number, slices: number) =>
  sql<number>`cast((${at} - ${from}) * ${slices} / ${to - from} as integer)`

/** The oldest desk bucket, where an "all" range starts; null before the first rollup. */
export const firstDeskBucket = async (db: Db) => {
  const [row] = await db
    .select({ bucket: sql<number | null>`min(${rollups.bucket})` })
    .from(rollups)
    .where(and(eq(rollups.kind, "desk"), eq(rollups.key, "desk")))
  return row?.bucket ?? null
}

/** Desk articles and new stories per slice of [from, to); empty slices are missing. */
export const deskSlices = (db: Db, from: number, to: number, slices: number) => {
  const slice = sliceOf(rollups.bucket, from, to, slices)
  return db
    .select({
      slice,
      articles: sql<number>`sum(${rollups.articles})`,
      newStories: sql<number>`sum(${rollups.newStories})`,
    })
    .from(rollups)
    .where(and(eq(rollups.kind, "desk"), eq(rollups.key, "desk"), gte(rollups.bucket, from), lt(rollups.bucket, to)))
    .groupBy(slice)
}

/** Extraction calls (story evaluations) per slice of [from, to); empty slices are missing. */
export const evaluationSlices = (db: Db, from: number, to: number, slices: number) => {
  const slice = sliceOf(llmCalls.at, from, to, slices)
  return db
    .select({ slice, n: sql<number>`count(*)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.purpose, "extraction"), gte(llmCalls.at, from), lt(llmCalls.at, to)))
    .groupBy(slice)
}

/** Active stories, and how many of them were first seen after `since`. */
export const activeStoryTotals = async (db: Db, since: number) => {
  const [row] = await db
    .select({ active: sql<number>`count(*)`, newSince: sql<number>`coalesce(sum(${stories.firstSeen} > ${since}), 0)` })
    .from(stories)
    .where(eq(stories.status, "active"))
  return { active: row?.active ?? 0, newSince: row?.newSince ?? 0 }
}

/** Articles per key and `bucketMs` bucket (an hour or a day) for `kind` in [from, to). */
export const rollupTotals = (db: Db, kind: RollupKind, keys: string[], from: number, to: number, bucketMs: number) => {
  const bucket = sql<number>`cast(${rollups.bucket} / ${bucketMs} as integer) * ${bucketMs}`
  return db
    .select({ key: rollups.key, bucket, articles: sql<number>`sum(${rollups.articles})` })
    .from(rollups)
    .where(and(eq(rollups.kind, kind), inArray(rollups.key, keys), gte(rollups.bucket, from), lt(rollups.bucket, to)))
    .groupBy(rollups.key, bucket)
}

/**
 * Stories with an article since `from`, best score first and unscored last, each with its article and distinct source
 * counts. `bucket` keeps those with an article published in it and lets closed stories in, so an old bucket still
 * lists what ran then; `q` keeps titles containing it.
 */
export const rankedStories = async (
  db: Db,
  opts: { from: number; limit: number; bucket?: { from: number; to: number }; q?: string },
) => {
  const { bucket, q } = opts
  const rows = await db
    .select({
      id: stories.id,
      category: stories.category,
      score: stories.score,
      lastArticleAt: stories.lastArticleAt,
      title: stories.title,
      summary: stories.summary,
      origins: stories.independentOrigins,
      momentum24h: stories.momentum24h,
    })
    .from(stories)
    .where(
      and(
        bucket ? inArray(stories.status, ["active", "closed"]) : eq(stories.status, "active"),
        gte(stories.lastArticleAt, bucket?.from ?? opts.from),
        q ? like(stories.title, `%${q}%`) : undefined,
        bucket
          ? inArray(
              stories.id,
              db
                .select({ id: articles.storyId })
                .from(articles)
                .where(and(gte(articles.publishedAt, bucket.from), lt(articles.publishedAt, bucket.to))),
            )
          : undefined,
      ),
    )
    .orderBy(desc(stories.score), desc(stories.lastArticleAt))
    .limit(opts.limit)
  const ids = rows.map((r) => r.id)
  const counts = ids.length
    ? await db
        .select({
          id: articles.storyId,
          articles: sql<number>`count(*)`,
          sources: sql<number>`count(distinct ${articles.sourceId})`,
        })
        .from(articles)
        .where(inArray(articles.storyId, ids))
        .groupBy(articles.storyId)
    : []
  const byId = new Map(counts.map((c) => [c.id, c]))
  return rows.map((r) => ({ ...r, articles: byId.get(r.id)?.articles ?? 0, sources: byId.get(r.id)?.sources ?? 0 }))
}

/** A story's facts, active first, then by salience; `sources` is the supporting article count. */
export const storyFacts = (db: Db, storyId: number, limit: number) =>
  db
    .select({
      id: facts.id,
      text: facts.text,
      status: facts.status,
      sources: sql<number>`json_array_length(${facts.supportingArticleIdsJson})`,
    })
    .from(facts)
    .where(eq(facts.storyId, storyId))
    .orderBy(sql`${facts.status} = 'active' desc`, desc(facts.salience), facts.firstSeen)
    .limit(limit)

/** Would-alert passes since `since` and the latest recorded database size (null before the first record). */
export const opsCounts = async (db: Db, since: number) => {
  const [[alerts], [size]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(gateLog)
      .where(and(eq(gateLog.gate, "alert"), eq(gateLog.decision, "pass"), gte(gateLog.at, since))),
    db.select({ bytes: dbStats.sizeBytes }).from(dbStats).orderBy(desc(dbStats.day)).limit(1),
  ])
  return { wouldAlert: alerts?.n ?? 0, dbBytes: size?.bytes ?? null }
}

/** Everything the story page lists besides the story row and its chart, each list capped at `limit` rows. */
export const storyDetail = async (db: Db, id: number, limit: number) => {
  const [factRows, articleRows, matches, vulnRows, gates, deliveryRows, votes, signalRows, [follow], audit] =
    await Promise.all([
      db.select().from(facts).where(eq(facts.storyId, id)).orderBy(desc(facts.salience), facts.firstSeen).limit(limit),
      storyArticles(db, id).limit(limit),
      // Newest placement first, so the first row per article is the one that stands.
      db
        .select({ articleId: matchLog.articleId, how: matchLog.how, cosine: matchLog.cosine })
        .from(matchLog)
        .innerJoin(articles, eq(articles.id, matchLog.articleId))
        .where(eq(articles.storyId, id))
        .orderBy(desc(matchLog.at), desc(matchLog.id))
        .limit(limit),
      db
        .select(getTableColumns(vulns))
        .from(storyVulns)
        .innerJoin(vulns, eq(vulns.cveId, storyVulns.cveId))
        .where(eq(storyVulns.storyId, id))
        .orderBy(desc(vulns.epss))
        .limit(limit),
      db.select().from(gateLog).where(eq(gateLog.storyId, id)).orderBy(desc(gateLog.at)).limit(limit),
      db.select().from(deliveries).where(eq(deliveries.storyId, id)).orderBy(desc(deliveries.sentAt)).limit(limit),
      db
        .select({ deliveryId: feedback.deliveryId, vote: feedback.vote, n: sql<number>`count(*)` })
        .from(feedback)
        .where(eq(feedback.storyId, id))
        .groupBy(feedback.deliveryId, feedback.vote)
        .limit(limit),
      db.select().from(signals).where(eq(signals.storyId, id)).orderBy(desc(signals.observedAt)).limit(limit),
      db.select().from(follows).where(eq(follows.storyId, id)),
      db
        .select()
        .from(actions)
        .where(and(eq(actions.subjectKind, "story"), eq(actions.subjectId, String(id))))
        .orderBy(desc(actions.at))
        .limit(limit),
    ])
  return {
    facts: factRows,
    articles: articleRows,
    matches,
    vulns: vulnRows,
    gates,
    deliveries: deliveryRows,
    votes,
    signals: signalRows,
    follow: follow ?? null,
    audit,
  }
}

/** One article with its source and story, or null. */
export const articleDetail = async (db: Db, id: number) => {
  const [row] = await db
    .select({
      id: articles.id,
      title: articles.title,
      snippet: articles.snippet,
      canonicalUrl: articles.canonicalUrl,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
      originId: articles.originId,
      storyId: articles.storyId,
      storyTitle: stories.title,
      embeddedAt: articles.embeddedAt,
      injectionSuspect: articles.injectionSuspect,
      sourceId: articles.sourceId,
      sourceName: sources.name,
      tier: sources.tier,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(stories, eq(stories.id, articles.storyId))
    .where(eq(articles.id, id))
  return row ?? null
}
