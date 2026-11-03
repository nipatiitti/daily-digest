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
import { type Rubric, stories } from "./stories.ts"
import { threads } from "./threads.ts"

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
    /** Null for messages without a story, e.g. "Nothing notable today". */
    storyId: integer().references(() => stories.id),
    /** The v2 event sent, and its thread when it had one; the thread cooldown reads these. */
    eventId: integer().references(() => events.id),
    threadId: integer().references(() => threads.id),
    kind: text({ enum: DELIVERY_KINDS }).notNull(),
    digestDate: text().references(() => digests.digestDate),
    chatId: integer().notNull(),
    messageId: integer(),
    replyToDeliveryId: integer().references((): AnySQLiteColumn => deliveries.id),
    factIdsJson: text({ mode: "json" }).$type<number[]>(),
    scoreAtSend: real(),
    /** Independent origins when sent; the update gate measures the origin jump from it. Null on older rows. */
    originsAtSend: integer(),
    sentAt: nowMs(),
    silent: flag(),
  },
  (t) => [
    index("deliveries_story_idx").on(t.storyId),
    index("deliveries_digest_date_idx").on(t.digestDate),
    index("deliveries_sent_at_idx").on(t.sentAt),
    index("deliveries_event_idx").on(t.eventId),
    index("deliveries_thread_idx").on(t.threadId),
  ],
)

/** `shadow` runs at the edition crons beside the live digest; `replay` re-runs a past edition as of its send time. */
export const SHADOW_MODES = ["shadow", "replay"] as const
export type ShadowMode = (typeof SHADOW_MODES)[number]

/** What the v2 edition would have sent, item by item, for comparing it with the edition that went out. */
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

export const VOTES = ["up", "down"] as const
export type Vote = (typeof VOTES)[number]

/** What the item was scored with when it was sent. */
export type RubricSnapshot = {
  configVersion: number
  rubric: Rubric | null
  weights: Record<string, number>
  score: number | null
}

export const feedback = sqliteTable(
  "feedback",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    deliveryId: integer()
      .notNull()
      .references(() => deliveries.id),
    storyId: integer().references(() => stories.id),
    /** Telegram user who tapped; one vote per user per delivery. */
    tgUserId: integer().notNull(),
    vote: text({ enum: VOTES }).notNull(),
    rubricSnapshotJson: text({ mode: "json" }).$type<RubricSnapshot>(),
    createdAt: nowMs(),
  },
  (t) => [unique("feedback_delivery_user_uq").on(t.deliveryId, t.tgUserId), index("feedback_story_idx").on(t.storyId)],
)

export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer().primaryKey(),
  receivedAt: nowMs(),
})

export type Delivery = typeof deliveries.$inferSelect
export type Digest = typeof digests.$inferSelect
