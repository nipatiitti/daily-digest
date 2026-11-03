import { getTableColumns } from "drizzle-orm"
import { chunkRows, type Db, runBatch } from "../client.ts"
import { matchLog } from "../schema/index.ts"

export const logMatch = async (db: Db, rows: (typeof matchLog.$inferInsert)[]) => {
  const width = Object.keys(getTableColumns(matchLog)).length
  await runBatch(
    db,
    chunkRows(rows, width).map((chunk) => db.insert(matchLog).values(chunk)),
  )
}
