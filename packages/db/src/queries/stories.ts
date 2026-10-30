import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import {
  articles,
  deliveries,
  type FactStatus,
  facts,
  feedback,
  type Rubric,
  rollups,
  sources,
  stories,
  storyVulns,
  vulns,
} from "../schema/index.ts"
import { refreshStoryCounters } from "./process.ts"

export const getStory = async (db: Db, id: number) => {
  const [row] = await db.select().from(stories).where(eq(stories.id, id))
  return row ?? null
}

/** A story's articles with the source fields evaluation and rendering need. */
export const storyArticles = (db: Db, storyId: number) =>
  db
    .select({
      id: articles.id,
      sourceId: articles.sourceId,
      sourceName: sources.name,
      sourceSlug: sources.slug,
      tier: sources.tier,
      authoritative: sources.authoritative,
      lang: sources.lang,
      title: articles.title,
      snippet: articles.snippet,
      canonicalUrl: articles.canonicalUrl,
      domain: articles.domain,
      publishedAt: articles.publishedAt,
      originId: articles.originId,
      injectionSuspect: articles.injectionSuspect,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(eq(articles.storyId, storyId))
    .orderBy(articles.publishedAt)

export type StoryArticle = Awaited<ReturnType<typeof storyArticles>>[number]

export const saveExtraction = (
  db: Db,
  storyId: number,
  e: {
    title: string
    summary: string
    whyMatters: string
    primaryEntity: string | null
    category: (typeof stories.$inferInsert)["category"]
    fiRelevance: number
    rubric: Rubric
    score: number
    tier: number
  },
) =>
  db
    .update(stories)
    .set({
      title: e.title,
      summary: e.summary,
      whyMatters: e.whyMatters,
      primaryEntity: e.primaryEntity,
      category: e.category,
      fiRelevance: e.fiRelevance,
      rubricJson: e.rubric,
      score: e.score,
      tier: e.tier,
    })
    .where(eq(stories.id, storyId))

export const flagStoryArticles = async (
  db: Db,
  storyId: number,
  f: { promotional: boolean; aggregator: boolean; entities: string[]; injectionSuspectIds: number[] },
) => {
  await db
    .update(articles)
    .set({ isPromotional: f.promotional, isAggregator: f.aggregator, entitiesJson: f.entities })
    .where(eq(articles.storyId, storyId))
  if (f.injectionSuspectIds.length > 0) {
    await db
      .update(articles)
      .set({ injectionSuspect: true })
      .where(and(eq(articles.storyId, storyId), inArray(articles.id, f.injectionSuspectIds)))
  }
}

export const activeFacts = (db: Db, storyId: number) =>
  db
    .select()
    .from(facts)
    .where(and(eq(facts.storyId, storyId), eq(facts.status, "active")))
    .orderBy(desc(facts.salience), facts.firstSeen)

export const insertFacts = async (db: Db, rows: (typeof facts.$inferInsert)[]) => {
  if (rows.length === 0) return []
  const results = await runBatch(
    db,
    chunkRows(rows, 8).map((chunk) => db.insert(facts).values(chunk).returning({ id: facts.id })),
  )
  return (results as { id: number }[][]).flat().map((r) => r.id)
}

export const setFactStatus = (db: Db, id: number, status: FactStatus) =>
  db.update(facts).set({ status }).where(eq(facts.id, id))

export const upsertVulns = async (db: Db, rows: (typeof vulns.$inferInsert)[]) => {
  for (const row of rows) {
    await db
      .insert(vulns)
      .values(row)
      .onConflictDoUpdate({
        target: vulns.cveId,
        set: {
          epss: row.epss ?? sql`${vulns.epss}`,
          kevDateAdded: row.kevDateAdded ?? sql`${vulns.kevDateAdded}`,
          updatedAt: row.updatedAt,
        },
      })
  }
}

export const linkStoryVulns = async (db: Db, storyId: number, cveIds: string[]) => {
  const rows = cveIds.map((cveId) => ({ storyId, cveId }))
  await runBatch(
    db,
    chunkRows(rows, 2).map((chunk) => db.insert(storyVulns).values(chunk).onConflictDoNothing()),
  )
}

/** KEV listing dates from the CISA KEV source's own articles (guid = CVE ID). */
export const kevDates = async (db: Db, cveIds: string[]) => {
  if (cveIds.length === 0) return new Map<string, number>()
  const rows = await db
    .select({ cve: articles.guid, at: articles.publishedAt })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(eq(sources.slug, "cisa-kev"), inArray(articles.guid, cveIds)))
  return new Map(rows.map((r) => [r.cve, r.at]))
}

export const storyVulnEpss = async (db: Db, storyId: number) => {
  const rows = await db
    .select({ epss: vulns.epss, kev: vulns.kevDateAdded })
    .from(storyVulns)
    .innerJoin(vulns, eq(vulns.cveId, storyVulns.cveId))
    .where(eq(storyVulns.storyId, storyId))
  return rows
}

/** The most recent delivery of a story, if any. */
export const lastDelivery = async (db: Db, storyId: number) => {
  const [row] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.storyId, storyId))
    .orderBy(desc(deliveries.sentAt))
    .limit(1)
  return row ?? null
}

export const alertsSince = async (db: Db, since: number) => {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(deliveries)
    .where(and(eq(deliveries.kind, "alert"), gte(deliveries.sentAt, since)))
  return row?.n ?? 0
}

/** Stories with no new article for the given period are closed. */
export const closeQuietStories = (db: Db, before: number) =>
  db
    .update(stories)
    .set({ status: "closed" })
    .where(and(eq(stories.status, "active"), lt(stories.lastArticleAt, before)))
    .returning({ id: stories.id })

export const databaseSize = async (db: Db) => {
  const [row] = await db.all<{ bytes: number }>(
    sql`select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()`,
  )
  return row?.bytes ?? 0
}

export const rowCounts = async (db: Db) => {
  const tables = ["sources", "articles", "stories", "facts", "deliveries", "feedback", "llm_calls", "gate_log"]
  const out: Record<string, number> = {}
  for (const t of tables) {
    const [row] = await db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(t)}`)
    out[t] = row?.n ?? 0
  }
  return out
}

export const unassignedArticleCount = async (db: Db) => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(articles).where(isNull(articles.storyId))
  return row?.n ?? 0
}

/**
 * Articles of active stories first seen since `since`, earliest first, with the story fields the hourly merge pass
 * reads. A story's first origin article (`originId` null) is its lead.
 */
export const recentStoryArticles = (db: Db, since: number) =>
  db
    .select({
      storyId: stories.id,
      storyTitle: stories.title,
      category: stories.category,
      firstSeen: stories.firstSeen,
      id: articles.id,
      sourceId: articles.sourceId,
      title: articles.title,
      originId: articles.originId,
      publishedAt: articles.publishedAt,
    })
    .from(articles)
    .innerJoin(stories, eq(stories.id, articles.storyId))
    .where(and(eq(stories.status, "active"), gte(stories.firstSeen, since)))
    .orderBy(articles.publishedAt)

const articleStoryChunk = (db: Db, ids: number[]) =>
  db
    .select({
      id: articles.id,
      sourceId: articles.sourceId,
      title: articles.title,
      storyId: stories.id,
      storyTitle: stories.title,
      status: stories.status,
      category: stories.category,
      firstSeen: stories.firstSeen,
    })
    .from(articles)
    .innerJoin(stories, eq(stories.id, articles.storyId))
    .where(inArray(articles.id, ids))

export type ArticleStory = Awaited<ReturnType<typeof articleStoryChunk>>[number]

/** The story each of these articles sits in, with its status and category, in one D1 batch. */
export const articleStories = async (db: Db, ids: number[]): Promise<ArticleStory[]> => {
  const chunks = chunkRows([...new Set(ids)], 1)
  const results = await runBatch(
    db,
    chunks.map((chunk) => articleStoryChunk(db, chunk)),
  )
  return (results as ArticleStory[][]).flat()
}

/**
 * Fold one story into another: articles, rollups, CVE links, facts, deliveries and their votes move, the merged story
 * is closed with a pointer, and the target's counters are recomputed. Deliveries move so a story that was sent stays
 * sent after a merge, and facts move so the novelty check compares new facts with everything already known. Gate log
 * rows stay with the story they were decided for. The target's extraction hash is cleared so the next process pass
 * re-evaluates it with the combined evidence.
 */
export const mergeStories = async (
  db: Db,
  fromId: number,
  intoId: number,
  now: number,
  opts?: { velocityWindowMinutes: number },
) => {
  if (fromId === intoId) return
  const links = await db.select({ cveId: storyVulns.cveId }).from(storyVulns).where(eq(storyVulns.storyId, fromId))
  // Articles and their story rollup rows move together, so the merged story's history follows it.
  const [from, into] = [String(fromId), String(intoId)]
  await runBatch(db, [
    db.update(articles).set({ storyId: intoId }).where(eq(articles.storyId, fromId)),
    db.update(facts).set({ storyId: intoId }).where(eq(facts.storyId, fromId)),
    db.update(deliveries).set({ storyId: intoId }).where(eq(deliveries.storyId, fromId)),
    db.update(feedback).set({ storyId: intoId }).where(eq(feedback.storyId, fromId)),
    // Columns in table order. A parameterised db.run(sql) can't go in a D1 batch, so the select is the raw part.
    db
      .insert(rollups)
      .select(
        sql`select bucket, 'story', ${into}, articles, origins, new_stories, score_sum, score_n, ${now}
          from ${rollups} where kind = 'story' and key = ${from}`,
      )
      .onConflictDoUpdate({
        target: [rollups.bucket, rollups.kind, rollups.key],
        set: {
          articles: sql`rollups.articles + excluded.articles`,
          origins: sql`rollups.origins + excluded.origins`,
          newStories: sql`rollups.new_stories + excluded.new_stories`,
          scoreSum: sql`excluded.score_sum`,
          scoreN: sql`excluded.score_n`,
          updatedAt: sql`excluded.updated_at`,
        },
      }),
    db.delete(rollups).where(and(eq(rollups.kind, "story"), eq(rollups.key, from))),
  ])
  await linkStoryVulns(
    db,
    intoId,
    links.map((l) => l.cveId),
  )
  await db
    .update(stories)
    .set({ status: "merged", mergedInto: intoId })
    .where(and(eq(stories.id, fromId), ne(stories.status, "merged")))
  await db.update(stories).set({ extractionHash: null }).where(eq(stories.id, intoId))
  await refreshStoryCounters(db, intoId, now, opts)
}
