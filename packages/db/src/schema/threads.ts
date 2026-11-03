import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { nowMs, vector } from "./common.ts"
import { events } from "./events.ts"
import { llmCalls } from "./ops.ts"

/** Provisional threads are hidden until they have enough events; closed ones reopen when an event joins. */
export const THREAD_STATUSES = ["provisional", "active", "closed", "merged"] as const
export type ThreadStatus = (typeof THREAD_STATUSES)[number]

/** A development that spans days or weeks, such as one election or one set of peace talks. Trends are counted on it. */
export const threads = sqliteTable(
  "threads",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull(),
    /** One sentence. */
    description: text().notNull(),
    status: text({ enum: THREAD_STATUSES }).notNull().default("provisional"),
    /** Set by a merge; new links go to this thread instead. */
    mergedInto: integer().references((): AnySQLiteColumn => threads.id),
    /** Mean of the member events' centroids. */
    centroid: vector().notNull(),
    firstSeen: integer().notNull(),
    /** Latest member event's last article. */
    lastSeen: integer().notNull(),
    /** Unmerged events linked to it. */
    eventCount: integer().notNull().default(0),
    /** Written hourly from rollups: signed percent change in articles, null for a rise from 0. */
    momentum24h: real("momentum_24h"),
    momentum7d: real("momentum_7d"),
  },
  (t) => [
    index("threads_status_last_seen_idx").on(t.status, t.lastSeen),
    index("threads_merged_into_idx").on(t.mergedInto),
  ],
)

export const eventThreads = sqliteTable(
  "event_threads",
  {
    eventId: integer()
      .notNull()
      .references(() => events.id),
    threadId: integer()
      .notNull()
      .references(() => threads.id),
    /** 0 to 1, from the model that assigned it; 1 for a manual link. The highest is the event's thread. */
    confidence: real().notNull(),
    /** Model ID, or `manual`. */
    by: text().notNull(),
    assignedAt: nowMs(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.threadId] }), index("event_threads_thread_idx").on(t.threadId)],
)

export const MOVER_KINDS = ["thread", "entity", "country"] as const
export type MoverKind = (typeof MOVER_KINDS)[number]

/** The hour's top movers for the home page, with a one-line reason for the first few. */
export const movers = sqliteTable(
  "movers",
  {
    /** Unix ms, start of the hour the list was computed in. */
    bucket: integer().notNull(),
    kind: text({ enum: MOVER_KINDS }).notNull(),
    /** Thread ID or entity ID as text, or the ISO country code. */
    key: text().notNull(),
    name: text().notNull(),
    articles24h: integer("articles_24h").notNull(),
    /** Signed percent change against the window before, null for a rise from 0. */
    change24h: real("change_24h"),
    change7d: real("change_7d"),
    /** 1 is the largest mover of the hour across all kinds. */
    rank: integer().notNull(),
    reason: text(),
    llmCallId: integer().references(() => llmCalls.id),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.kind, t.key] }), index("movers_bucket_rank_idx").on(t.bucket, t.rank)],
)

export type Thread = typeof threads.$inferSelect
export type EventThread = typeof eventThreads.$inferSelect
export type Mover = typeof movers.$inferSelect
