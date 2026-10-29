import { and, eq, gte, inArray, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { DASHBOARD_LLM_PURPOSES, llmAnswers, llmCalls } from "../schema/index.ts"

export type AnswerKey = Pick<typeof llmAnswers.$inferInsert, "purpose" | "subjectKind" | "subjectId" | "inputHash">

/** The stored answer for exactly this input, or undefined. */
export const cachedAnswer = async (db: Db, k: AnswerKey) => {
  const [row] = await db
    .select()
    .from(llmAnswers)
    .where(
      and(
        eq(llmAnswers.purpose, k.purpose),
        eq(llmAnswers.subjectKind, k.subjectKind),
        eq(llmAnswers.subjectId, k.subjectId),
        eq(llmAnswers.inputHash, k.inputHash),
      ),
    )
  return row
}

/** Two clicks on the same input both stream; the first answer stored wins. */
export const storeAnswer = (db: Db, row: typeof llmAnswers.$inferInsert) =>
  db.insert(llmAnswers).values(row).onConflictDoNothing()

/** Claude spend in USD since `since` (unix ms) on dashboard purposes only, for DASHBOARD_SPEND_CAP_USD. */
export const dashboardSpendSince = async (db: Db, since: number) => {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.estCostUsd}), 0)` })
    .from(llmCalls)
    .where(and(inArray(llmCalls.purpose, [...DASHBOARD_LLM_PURPOSES]), gte(llmCalls.at, since)))
  return row?.total ?? 0
}
