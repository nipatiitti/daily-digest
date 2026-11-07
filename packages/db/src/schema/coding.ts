import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { flag } from "./common.ts"
import { events } from "./events.ts"
import { llmCalls } from "./ops.ts"

/** What an event's newest reports say happened, in kinds that fit every field. The first group are action acts. */
export const ACTION_ACTS = [
  "decision",
  "ruling",
  "law",
  "election_result",
  "appointment",
  "agreement",
  "funding",
  "release",
  "disclosure",
  "breach_or_attack",
  "incident",
  "disaster",
  "violence",
  "protest",
  "market_move",
  "results",
  "research",
] as const
/** Words about something rather than the thing itself: never material. */
export const TALK_ACTS = ["statement", "claim", "threat", "plan", "analysis"] as const
export const ACTS = [...ACTION_ACTS, ...TALK_ACTS, "other"] as const
export type Act = (typeof ACTS)[number]

/**
 * One Haiku code per substantial event, profile-free, for the edition's significance gate and for trend questions
 * later. Written again when the event's independent origins double, or grow a day after it was coded.
 */
export const eventCodes = sqliteTable(
  "event_codes",
  {
    eventId: integer()
      .primaryKey()
      .references(() => events.id),
    /** Something happened: an action, decision, outcome, disclosure or turning point, never only talk. */
    material: flag(),
    /** 0 to 100: people or systems affected and how much, reach, reversibility, firsts. */
    significance: integer().notNull(),
    act: text({ enum: ACTS }).notNull(),
    /** -2 to +2: a bad or good development for its main subject. */
    valence: integer().notNull(),
    /** -10 (violence, hostility) to +10 (agreement, cooperation); null unless an interaction between parties. */
    stance: integer(),
    /** One line for the dashboard. */
    reason: text().notNull(),
    originsAtCode: integer().notNull(),
    codedAt: integer().notNull(),
    llmCallId: integer().references(() => llmCalls.id),
  },
  (t) => [index("event_codes_coded_at_idx").on(t.codedAt)],
)

export const ACTOR_ROLES = ["actor", "target"] as const
export type ActorRole = (typeof ACTOR_ROLES)[number]

/** Who acts and who is acted on in a coded event: an entity key, or an ISO country code. */
export const eventActors = sqliteTable(
  "event_actors",
  {
    eventId: integer()
      .notNull()
      .references(() => events.id),
    actor: text().notNull(),
    role: text({ enum: ACTOR_ROLES }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.actor, t.role] }), index("event_actors_actor_idx").on(t.actor)],
)

export type EventCode = typeof eventCodes.$inferSelect
