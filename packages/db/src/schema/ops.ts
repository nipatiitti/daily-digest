import { index, integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { nowMs } from "./common.ts"
import { events } from "./events.ts"

/** How the process stage placed an article; the `-fallback` pair is the ask band without a usable LLM. */
export const MATCH_HOWS = ["new", "join", "copy", "cve", "ask-yes", "ask-no", "join-fallback", "new-fallback"] as const
export type MatchHow = (typeof MATCH_HOWS)[number]

export const GATES = ["evidence", "alert", "update", "digest", "follow"] as const
export type Gate = (typeof GATES)[number]

export const GATE_DECISIONS = ["pass", "fail"] as const
export type GateDecision = (typeof GATE_DECISIONS)[number]

/**
 * Calls a person starts from the dashboard, never the pipeline: the purpose alone tells their `llm_calls` rows apart,
 * and they count against DASHBOARD_SPEND_CAP_USD.
 */
export const DASHBOARD_LLM_PURPOSES = ["explain", "compare", "review", "ask"] as const

export const LLM_PURPOSES = [
  "match",
  "merge",
  "novelty",
  "extraction",
  "writeup",
  "digest_edit",
  "theme",
  "brief",
  "theme_explain",
  "facets",
  "cluster",
  "consolidate",
  "thread",
  "relevance",
  "edition_cut",
  "edition_copy",
  "reactions",
  "movers",
  "story",
  "coding",
  ...DASHBOARD_LLM_PURPOSES,
] as const
export type LlmPurpose = (typeof LLM_PURPOSES)[number]

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    purpose: text({ enum: LLM_PURPOSES }).notNull(),
    model: text().notNull(),
    eventId: integer().references(() => events.id),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cachedTokens: integer().notNull().default(0),
    estCostUsd: real().notNull(),
    /** Set when the response failed schema validation, was refused, or a streamed answer broke off. */
    validationError: text(),
    at: nowMs(),
  },
  (t) => [index("llm_calls_at_idx").on(t.at), index("llm_calls_purpose_at_idx").on(t.purpose, t.at)],
)

export const ACTION_KINDS = [
  "close",
  "merge",
  "follow",
  "fact_status",
  "requeue",
  "move_article",
  "new_story",
  "edit",
  "source_toggle",
  "source_poll",
  "source_reset",
  "send_now",
  "theme_rename",
  "theme_merge",
  "theme_close",
  "theme_detach",
  "entity_merge",
  "entity_rename",
  "profile_edit",
  "proposal_accept",
  "proposal_reject",
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export const ACTION_SUBJECTS = [
  "story",
  "article",
  "source",
  "theme",
  "entity",
  "fact",
  "cell",
  "event",
  "thread",
  "country",
  "profile",
] as const
export type ActionSubject = (typeof ACTION_SUBJECTS)[number]

/** Audit log: one row per dashboard write, with the Access email of who made it. Never deleted. */
export const actions = sqliteTable(
  "actions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    kind: text({ enum: ACTION_KINDS }).notNull(),
    subjectKind: text({ enum: ACTION_SUBJECTS }).notNull(),
    subjectId: text().notNull(),
    detailJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    by: text().notNull(),
    at: nowMs(),
  },
  (t) => [index("actions_at_idx").on(t.at), index("actions_subject_idx").on(t.subjectKind, t.subjectId)],
)

export type Action = typeof actions.$inferSelect

/** On-demand Claude answers on the dashboard, kept until their input changes. */
export const llmAnswers = sqliteTable(
  "llm_answers",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    purpose: text({ enum: DASHBOARD_LLM_PURPOSES }).notNull(),
    subjectKind: text({ enum: ACTION_SUBJECTS }).notNull(),
    subjectId: text().notNull(),
    /** SHA-256 of everything the model was given, so a changed story or prompt asks again. */
    inputHash: text().notNull(),
    text: text().notNull(),
    /** The SIG- and STY- ids the text cites. */
    refsJson: text({ mode: "json" }).$type<string[]>().notNull(),
    llmCallId: integer().references(() => llmCalls.id),
    at: nowMs(),
  },
  (t) => [unique("llm_answers_key_uq").on(t.purpose, t.subjectKind, t.subjectId, t.inputHash)],
)

export const dbStats = sqliteTable("db_stats", {
  /** YYYY-MM-DD, UTC */
  day: text().primaryKey(),
  sizeBytes: integer().notNull(),
  rowsJson: text({ mode: "json" }).$type<Record<string, number>>().notNull(),
})
