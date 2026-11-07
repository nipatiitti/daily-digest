import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core"
import { flag, nowMs } from "./common.ts"
import { events } from "./events.ts"
import { stories, threads } from "./threads.ts"

export const DIGEST_STATUSES = ["claimed", "sent", "failed"] as const
export type DigestStatus = (typeof DIGEST_STATUSES)[number]

/** One row per edition; inserting it is the Digest workflow's idempotency claim. */
export const digests = sqliteTable("digests", {
  /** Edition key: YYYY-MM-DD (UTC) for the morning edition, YYYY-MM-DD-afternoon for the afternoon one. */
  digestDate: text().primaryKey(),
  status: text({ enum: DIGEST_STATUSES }).notNull().default("claimed"),
  startedAt: nowMs(),
  sentAt: integer(),
  itemCount: integer(),
})

export const DELIVERY_KINDS = ["digest", "alert", "update", "follow"] as const
export type DeliveryKind = (typeof DELIVERY_KINDS)[number]

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** The v2 event sent, and its thread when it had one; the thread cooldown reads these. */
    eventId: integer().references(() => events.id),
    threadId: integer().references(() => threads.id),
    kind: text({ enum: DELIVERY_KINDS }).notNull(),
    digestDate: text().references(() => digests.digestDate),
    chatId: integer().notNull(),
    messageId: integer(),
    scoreAtSend: real(),
    /** Independent origins when sent; the update gate measures the origin jump from it. Null on older rows. */
    originsAtSend: integer(),
    sentAt: nowMs(),
    silent: flag(),
    /** The edition item a digest delivery sent, and its story. */
    editionItemId: integer().references((): AnySQLiteColumn => editionItems.id),
    storyId: integer().references(() => stories.id),
  },
  (t) => [
    index("deliveries_digest_date_idx").on(t.digestDate),
    index("deliveries_sent_at_idx").on(t.sentAt),
    index("deliveries_event_idx").on(t.eventId),
    index("deliveries_thread_idx").on(t.threadId),
  ],
)

/** `shadow` runs at the edition crons beside the live digest; `replay` re-runs a past edition as of its send time. */
export const SHADOW_MODES = ["shadow", "replay"] as const
export type ShadowMode = (typeof SHADOW_MODES)[number]

/** What the v2 edition would have sent, item by item. No longer written since edition_items; dropped later. */
export const digestsShadow = sqliteTable(
  "digests_shadow",
  {
    /** Edition key, as `digests.digestDate`. */
    editionKey: text().notNull(),
    mode: text({ enum: SHADOW_MODES }).notNull(),
    /** 1 is the first item. */
    rank: integer().notNull(),
    eventId: integer()
      .notNull()
      .references(() => events.id),
    threadId: integer().references(() => threads.id),
    /** relevance x importance x freshness, and the relevance part alone. */
    score: real().notNull(),
    relevance: integer().notNull(),
    /** The item as Telegram would render it. */
    text: text().notNull(),
    /** When the edition was computed as of: its send time for a replay. */
    asOf: integer().notNull(),
    at: nowMs(),
  },
  (t) => [primaryKey({ columns: [t.editionKey, t.mode, t.rank] })],
)

/** "send" is the edition that went out; "replay" re-runs a past edition as of its send time, never sent. */
export const EDITION_MODES = ["send", "replay"] as const
export type EditionMode = (typeof EDITION_MODES)[number]

/**
 * One item of an edition: a story's one combined update, or a storyless thread or event. The latest item of a story
 * is the reader's last brief on it, which the next change judgment and copy read.
 */
export const editionItems = sqliteTable(
  "edition_items",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** As `digests.digestDate`. */
    editionKey: text().notNull(),
    mode: text({ enum: EDITION_MODES }).notNull(),
    /** 1 is the first item. */
    rank: integer().notNull(),
    storyId: integer().references(() => stories.id),
    threadId: integer().references(() => threads.id),
    /** The carrier the item leads with; its copy is stored on the event too. */
    leadEventId: integer()
      .notNull()
      .references(() => events.id),
    headline: text().notNull(),
    summary: text().notNull(),
    /** The item as Telegram renders it. */
    text: text().notNull(),
    /** The story had a brief before this one. */
    isUpdate: flag(),
    /** The lead's significance after the interest boost, 0 to 100. */
    gate: integer().notNull(),
    /** gate x corroboration x freshness, the order in the edition. */
    score: real().notNull(),
    asOf: integer().notNull(),
    at: nowMs(),
  },
  (t) => [
    unique("edition_items_key_mode_rank_uq").on(t.editionKey, t.mode, t.rank),
    index("edition_items_story_idx").on(t.storyId, t.asOf),
    index("edition_items_lead_idx").on(t.leadEventId),
  ],
)

/** The events an item carries, the lead among them. */
export const editionItemEvents = sqliteTable(
  "edition_item_events",
  {
    itemId: integer()
      .notNull()
      .references(() => editionItems.id),
    eventId: integer()
      .notNull()
      .references(() => events.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.eventId] }), index("edition_item_events_event_idx").on(t.eventId)],
)

export const STORY_CHANGES = ["none", "minor", "major"] as const
export type StoryChange = (typeof STORY_CHANGES)[number]

/** What became of an edition candidate, item or not. */
export const OUTCOMES = [
  "sent",
  "uncoded",
  "muted",
  "talk",
  "below_bar",
  "no_change",
  "minor_change",
  "not_judged",
  "not_carried",
  "copy_skip",
  "over_max",
] as const
export type Outcome = (typeof OUTCOMES)[number]

/** Every candidate of an edition with its code, interest, gate and outcome, for the "Held back" list. */
export const editionJudgments = sqliteTable(
  "edition_judgments",
  {
    editionKey: text().notNull(),
    mode: text({ enum: EDITION_MODES }).notNull(),
    eventId: integer()
      .notNull()
      .references(() => events.id),
    storyId: integer().references(() => stories.id),
    threadId: integer().references(() => threads.id),
    significance: integer(),
    material: integer({ mode: "boolean" }),
    act: text(),
    interest: integer(),
    gate: integer(),
    /** The story's change since its last brief; null for a storyless group or one never judged. */
    change: text({ enum: STORY_CHANGES }),
    outcome: text({ enum: OUTCOMES }).notNull(),
    /** The change judgment's reason, else the code's. */
    reason: text(),
    asOf: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.editionKey, t.mode, t.eventId] })],
)

export const VOTES = ["up", "down"] as const
export type Vote = (typeof VOTES)[number]

export const feedback = sqliteTable(
  "feedback",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    deliveryId: integer()
      .notNull()
      .references(() => deliveries.id),
    /** Telegram user who tapped; one vote per user per delivery. */
    tgUserId: integer().notNull(),
    vote: text({ enum: VOTES }).notNull(),
    createdAt: nowMs(),
  },
  (t) => [unique("feedback_delivery_user_uq").on(t.deliveryId, t.tgUserId)],
)

export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer().primaryKey(),
  receivedAt: nowMs(),
})

export type Delivery = typeof deliveries.$inferSelect
export type EditionItem = typeof editionItems.$inferSelect
export type EditionJudgment = typeof editionJudgments.$inferSelect
export type Digest = typeof digests.$inferSelect
