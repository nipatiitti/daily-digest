import { eq, getTableColumns, isNull, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { articleFacets, articles, eventArticles, sources } from "../schema/index.ts"

/** Articles not yet placed in an event: what the facet-q consumer still has to ingest. */
export const ingestBacklog = async (db: Db) => {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(articles)
    .leftJoin(eventArticles, eq(eventArticles.articleId, articles.id))
    .where(isNull(eventArticles.articleId))
  return row?.n ?? 0
}

/** The oldest fetched articles with no event yet, with their source and any facets a crashed run already wrote. */
export const articlesToIngest = (db: Db, limit: number) =>
  db
    .select({
      id: articles.id,
      sourceId: articles.sourceId,
      title: articles.title,
      snippet: articles.snippet,
      lang: sql<string>`coalesce(${articles.lang}, ${sources.lang})`,
      publishedAt: articles.publishedAt,
      source: sources.name,
      sourceCountry: sources.country,
      sourceRole: sources.role,
      facets: articleFacets,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(eventArticles, eq(eventArticles.articleId, articles.id))
    .leftJoin(articleFacets, eq(articleFacets.articleId, articles.id))
    .where(isNull(eventArticles.articleId))
    .orderBy(articles.fetchedAt, articles.id)
    .limit(limit)

export type IngestArticle = Awaited<ReturnType<typeof articlesToIngest>>[number]

export const saveFacets = (db: Db, rows: (typeof articleFacets.$inferInsert)[]) =>
  runBatch(
    db,
    chunkRows(rows, Object.keys(getTableColumns(articleFacets)).length).map((chunk) =>
      db.insert(articleFacets).values(chunk).onConflictDoNothing(),
    ),
  )

/** Every outlet's name, so entity linking can skip the outlets themselves. */
export const sourceNames = async (db: Db) => (await db.select({ name: sources.name }).from(sources)).map((r) => r.name)
