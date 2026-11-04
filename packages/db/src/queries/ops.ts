import { and, gte, notInArray, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { DASHBOARD_LLM_PURPOSES, dbStats, llmCalls } from "../schema/index.ts"

/** Pipeline Claude spend in USD since `since` (unix ms), for the daily cap. Dashboard purposes have their own cap. */
export const spendSince = async (db: Db, since: number) => {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.estCostUsd}), 0)` })
    .from(llmCalls)
    .where(and(gte(llmCalls.at, since), notInArray(llmCalls.purpose, [...DASHBOARD_LLM_PURPOSES])))
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
