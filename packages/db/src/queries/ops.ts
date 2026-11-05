import { and, gte, lt, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { dbStats, llmCalls } from "../schema/index.ts"

/** Claude spend in USD over every purpose, dashboard ones included, in [from, to). */
export const totalSpendBetween = async (db: Db, from: number, to: number) => {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.estCostUsd}), 0)` })
    .from(llmCalls)
    .where(and(gte(llmCalls.at, from), lt(llmCalls.at, to)))
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
