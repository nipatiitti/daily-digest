import type { Db } from "@digest/db"
import { createLlm } from "@digest/llm"

/** Null until ANTHROPIC_API_KEY is set; LLM steps then fall back or skip. */
export const llmFor = (env: Env, db: Db) =>
  env.ANTHROPIC_API_KEY
    ? createLlm({
        apiKey: env.ANTHROPIC_API_KEY,
        baseURL: env.ANTHROPIC_BASE_URL,
        db,
        dailyCapUsd: Number(env.DAILY_SPEND_CAP_USD) || 3.33,
      })
    : null
