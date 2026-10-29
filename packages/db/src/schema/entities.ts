import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { stories } from "./stories.ts"

/** Place and person are only set by hand for now; the hourly fold writes cve, product or org. */
export const ENTITY_KINDS = ["org", "product", "place", "person", "cve", "other"] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/** Organisations, products and CVEs named by story extractions, one row per normalised key. */
export const entities = sqliteTable(
  "entities",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** core's normaliseEntityKey(name). */
    key: text().notNull().unique(),
    /** Display form, as first seen. */
    name: text().notNull(),
    kind: text({ enum: ENTITY_KINDS }).notNull(),
    /** Earliest first-seen and latest last-article time of its stories. */
    firstSeen: integer().notNull(),
    lastSeen: integer().notNull(),
    /** Unmerged stories linked to it. */
    storyCount: integer().notNull().default(0),
    /** Written hourly from entity rollups, like the story columns. */
    momentum24h: real("momentum_24h"),
    momentum7d: real("momentum_7d"),
    /** Set by a manual alias merge; new links go to this entity instead. */
    mergedInto: integer().references((): AnySQLiteColumn => entities.id),
  },
  (t) => [index("entities_last_seen_idx").on(t.lastSeen)],
)

export const storyEntities = sqliteTable(
  "story_entities",
  {
    storyId: integer()
      .notNull()
      .references(() => stories.id),
    entityId: integer()
      .notNull()
      .references(() => entities.id),
    /** The story's first-seen time. */
    firstSeen: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.entityId] }), index("story_entities_entity_idx").on(t.entityId)],
)

/** Shared by the hourly steps: when each last finished, and what it wants the next run to know. */
export const hourlyRuns = sqliteTable("hourly_runs", {
  step: text().primaryKey(),
  lastRunAt: integer().notNull(),
  detailJson: text({ mode: "json" }).$type<Record<string, number>>(),
})

export type Entity = typeof entities.$inferSelect
export type StoryEntity = typeof storyEntities.$inferSelect
