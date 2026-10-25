import { getTableColumns } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { articles, type NewArticle } from "../schema/index.ts"

/** INSERT OR IGNORE on canonical URL and (source, guid); returns the IDs that were new. */
export const insertArticles = async (db: Db, rows: NewArticle[]) => {
  const width = Object.keys(getTableColumns(articles)).length
  const results = await runBatch(
    db,
    chunkRows(rows, width).map((chunk) =>
      db.insert(articles).values(chunk).onConflictDoNothing().returning({ id: articles.id }),
    ),
  )
  return (results as { id: number }[][]).flat().map((r) => r.id)
}
