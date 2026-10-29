import { desc, eq, getTableColumns } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { matchLog } from "../schema/index.ts"

export const logMatch = async (db: Db, rows: (typeof matchLog.$inferInsert)[]) => {
  const width = Object.keys(getTableColumns(matchLog)).length
  await runBatch(
    db,
    chunkRows(rows, width).map((chunk) => db.insert(matchLog).values(chunk)),
  )
}

/** Placements of one article, newest first. */
export const matchLogFor = (db: Db, articleId: number) =>
  db.select().from(matchLog).where(eq(matchLog.articleId, articleId)).orderBy(desc(matchLog.at), desc(matchLog.id))
