import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { flag, nowMs } from "./common.ts"
import { type Rubric, stories } from "./stories.ts"

export const DIGEST_STATUSES = ["claimed", "sent", "failed"] as const
export type DigestStatus = (typeof DIGEST_STATUSES)[number]

/** One row per day; inserting it is the Digest workflow's idempotency claim. */
export const digests = sqliteTable("digests", {
  /** YYYY-MM-DD, UTC */
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
    kind: text({ enum: DELIVERY_KINDS }).notNull(),
    digestDate: text().references(() => digests.digestDate),
    chatId: integer().notNull(),
    messageId: integer(),
    replyToDeliveryId: integer().references((): AnySQLiteColumn => deliveries.id),
    factIdsJson: text({ mode: "json" }).$type<number[]>(),
    scoreAtSend: real(),
    sentAt: nowMs(),
    silent: flag(),
  },
  (t) => [
    index("deliveries_story_idx").on(t.storyId),
    index("deliveries_digest_date_idx").on(t.digestDate),
    index("deliveries_sent_at_idx").on(t.sentAt),
  ],
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
