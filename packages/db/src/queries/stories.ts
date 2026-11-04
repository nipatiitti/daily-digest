import { eq, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { articles, sources } from "../schema/index.ts"

/** A v1 story's articles with the source fields rendering needs, for the dashboard's archive of v1 editions. */
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

export const databaseSize = async (db: Db) => {
  const [row] = await db.all<{ bytes: number }>(
    sql`select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()`,
  )
  return row?.bytes ?? 0
}

export const rowCounts = async (db: Db) => {
  const tables = ["sources", "articles", "events", "threads", "deliveries", "feedback", "llm_calls", "profile_versions"]
  const out: Record<string, number> = {}
  for (const t of tables) {
    const [row] = await db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(t)}`)
    out[t] = row?.n ?? 0
  }
  return out
}
