import { gte, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { dbStats, llmCalls } from "../schema/index.ts"

/** Claude spend in USD since `since` (unix ms), for the daily cap. */
export const spendSince = async (db: Db, since: number) => {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.estCostUsd}), 0)` })
    .from(llmCalls)
    .where(gte(llmCalls.at, since))
  return row?.total ?? 0
}

export const recordLlmCall = (db: Db, row: typeof llmCalls.$inferInsert) => db.insert(llmCalls).values(row)

export const recordDbStats = (db: Db, row: typeof dbStats.$inferInsert) =>
  db
    .insert(dbStats)
    .values(row)
    .onConflictDoUpdate({
      target: dbStats.day,
      set: { sizeBytes: row.sizeBytes, rowsJson: row.rowsJson },
    })
