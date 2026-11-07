import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { flag, nowMs } from "./common.ts"
import { events } from "./events.ts"
import { llmCalls } from "./ops.ts"

/** Weight 1 is a passing interest, 3 a core one. */
export type ProfileTopic = { name: string; weight: number }

/** Threads by ID, entities by key (core's normaliseEntityKey), countries by ISO code. */
export type ProfileFollows = { threads: number[]; entities: string[]; countries: string[] }

/** The reader's interest profile, as relevance scoring and the digest read it. */
export type Profile = {
  /** Free text: who the reader is and what they care about. */
  text: string
  topics: ProfileTopic[]
  follows: ProfileFollows
  /** ISO codes of the regions that matter more, such as FI or EU. */
  regions: string[]
  /** Things never worth sending, in plain words. */
  mutes: string[]
}

/** Append-only: the current profile is the highest version. Every relevance score records the version it used. */
export const profileVersions = sqliteTable("profile_versions", {
  version: integer().primaryKey(),
  text: text().notNull(),
  topicsJson: text({ mode: "json" }).$type<ProfileTopic[]>().notNull(),
  followsJson: text({ mode: "json" }).$type<ProfileFollows>().notNull(),
  regionsJson: text({ mode: "json" }).$type<string[]>().notNull(),
  mutesJson: text({ mode: "json" }).$type<string[]>().notNull(),
  /** What changed, in a few words. */
  note: text(),
  /** The accepted proposal this version came from. */
  proposalId: integer(),
  /** Access email, `seed`, or `reactions`. */
  by: text().notNull(),
  createdAt: nowMs(),
})

/** One change a proposal makes; follows are changed on the dashboard, never proposed. */
export type ProfileEdit =
  | { op: "set_topic"; name: string; weight: number }
  | { op: "remove_topic"; name: string }
  | { op: "add_mute"; value: string }
  | { op: "remove_mute"; value: string }
  | { op: "add_region"; value: string }
  | { op: "remove_region"; value: string }
  | { op: "append_text"; value: string }

export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** Profile edits the nightly reactions step proposes from the week's votes; the reader accepts or rejects them. */
export const profileProposals = sqliteTable(
  "profile_proposals",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    basedOnVersion: integer().notNull(),
    editsJson: text({ mode: "json" }).$type<ProfileEdit[]>().notNull(),
    /** One or two sentences on which votes suggest the edits. */
    rationale: text().notNull(),
    /** The `feedback` rows it was drawn from. */
    feedbackIdsJson: text({ mode: "json" }).$type<number[]>().notNull(),
    status: text({ enum: PROPOSAL_STATUSES }).notNull().default("pending"),
    decidedAt: integer(),
    decidedBy: text(),
    llmCallId: integer().references(() => llmCalls.id),
    createdAt: nowMs(),
  },
  (t) => [index("profile_proposals_status_idx").on(t.status, t.createdAt)],
)

/** Haiku's 0 to 100 relevance of an event to one profile version, with a one-line reason. */
export const relevance = sqliteTable(
  "relevance",
  {
    eventId: integer()
      .notNull()
      .references(() => events.id),
    profileVersion: integer().notNull(),
    score: integer().notNull(),
    reason: text().notNull(),
    /** The event's independent origins when scored; it is scored again once they double. */
    originsAtScore: integer().notNull(),
    llmCallId: integer().references(() => llmCalls.id),
    at: nowMs(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.profileVersion] }), index("relevance_at_idx").on(t.at)],
)

/**
 * Haiku's 0 to 3 interest of an event to one profile version: how far the reader's niche topics, regions and follows
 * lift it. It never lowers anything; `muted` is set only when a mute describes the event.
 */
export const interest = sqliteTable(
  "interest",
  {
    eventId: integer()
      .notNull()
      .references(() => events.id),
    profileVersion: integer().notNull(),
    level: integer().notNull(),
    muted: flag(),
    reason: text().notNull(),
    /** The event's independent origins when scored; it is scored again once they double. */
    originsAtScore: integer().notNull(),
    llmCallId: integer().references(() => llmCalls.id),
    at: nowMs(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.profileVersion] }), index("interest_at_idx").on(t.at)],
)

export type ProfileVersion = typeof profileVersions.$inferSelect
export type ProfileProposal = typeof profileProposals.$inferSelect
export type Relevance = typeof relevance.$inferSelect
export type Interest = typeof interest.$inferSelect
