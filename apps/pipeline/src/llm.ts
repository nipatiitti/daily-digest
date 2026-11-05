import { SPEND } from "@digest/core"
import type { Db } from "@digest/db"
import { createLlm, type Llm } from "@digest/llm"

/** Null until ANTHROPIC_API_KEY is set; LLM steps then fall back or skip. */
export const llmFor = (env: Env, db: Db) =>
  env.ANTHROPIC_API_KEY
    ? createLlm({
        apiKey: env.ANTHROPIC_API_KEY,
        baseURL: env.ANTHROPIC_BASE_URL,
        db,
        monthlyBudgetUsd: Number(env.MONTHLY_BUDGET_USD) || SPEND.monthlyBudgetUsd,
      })
    : null

/** Today's spend and the soft cap once spend reached SPEND.softCapShare of today's allowance; null while under it. */
export const overSoftCap = async (llm: Llm): Promise<{ spent: number; cap: number } | null> => {
  const spent = await llm.spentToday()
  const cap = SPEND.softCapShare * (await llm.allowanceToday())
  return spent >= cap ? { spent, cap } : null
}
