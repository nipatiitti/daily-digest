import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { articles } from "./articles.ts"
import { nowMs } from "./common.ts"
import { stories } from "./stories.ts"

/** How the process stage placed an article; the `-fallback` pair is the ask band without a usable LLM. */
export const MATCH_HOWS = ["new", "join", "copy", "cve", "ask-yes", "ask-no", "join-fallback", "new-fallback"] as const
export type MatchHow = (typeof MATCH_HOWS)[number]

/** One row per article placement, for calibrating the match thresholds. */
export const matchLog = sqliteTable(
  "match_log",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    articleId: integer()
      .notNull()
      .references(() => articles.id),
    storyId: integer().references(() => stories.id),
    how: text({ enum: MATCH_HOWS }).notNull(),
    /** Similarity of the best candidate, after the same-source penalty. */
    cosine: real(),
    /** Best candidate story considered, even when a new story was started. */
    candidateStoryId: integer().references(() => stories.id),
    at: nowMs(),
  },
  (t) => [index("match_log_article_idx").on(t.articleId), index("match_log_story_idx").on(t.storyId)],
)

export type MatchLogRow = typeof matchLog.$inferSelect

export const GATES = ["evidence", "alert", "update", "digest", "follow"] as const
export type Gate = (typeof GATES)[number]

export const GATE_DECISIONS = ["pass", "fail"] as const
export type GateDecision = (typeof GATE_DECISIONS)[number]

/** Every gate decision. In shadow mode a pass is logged ("would alert") but not acted on. */
export const gateLog = sqliteTable(
  "gate_log",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    storyId: integer()
      .notNull()
      .references(() => stories.id),
    gate: text({ enum: GATES }).notNull(),
    decision: text({ enum: GATE_DECISIONS }).notNull(),
    reasonsJson: text({ mode: "json" }).$type<string[]>().notNull(),
    shadow: integer({ mode: "boolean" }).notNull(),
    at: nowMs(),
  },
  (t) => [index("gate_log_story_idx").on(t.storyId), index("gate_log_at_idx").on(t.at)],
)

export const LLM_PURPOSES = ["match", "merge", "novelty", "extraction", "writeup", "digest_edit"] as const
export type LlmPurpose = (typeof LLM_PURPOSES)[number]

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    purpose: text({ enum: LLM_PURPOSES }).notNull(),
    model: text().notNull(),
    storyId: integer().references(() => stories.id),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cachedTokens: integer().notNull().default(0),
    estCostUsd: real().notNull(),
    /** Set when the response failed schema validation. */
    validationError: text(),
    at: nowMs(),
  },
  (t) => [index("llm_calls_at_idx").on(t.at)],
)

export const dbStats = sqliteTable("db_stats", {
  /** YYYY-MM-DD, UTC */
  day: text().primaryKey(),
  sizeBytes: integer().notNull(),
  rowsJson: text({ mode: "json" }).$type<Record<string, number>>().notNull(),
})
