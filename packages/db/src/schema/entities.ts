import { type AnySQLiteColumn, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** Ingest writes the kind from article facets (FACET_ENTITY_KINDS); cve and other are left from v1. */
export const ENTITY_KINDS = ["org", "product", "place", "person", "topic", "cve", "other"] as const
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
    /** Earliest first-seen and latest article time of its events. */
    firstSeen: integer().notNull(),
    lastSeen: integer().notNull(),
    /** Unmerged events linked to it. */
    eventCount: integer().notNull().default(0),
    /** Written hourly from entity rollups. */
    momentum24h: real("momentum_24h"),
    momentum7d: real("momentum_7d"),
    /** Set by a manual alias merge; new links go to this entity instead. */
    mergedInto: integer().references((): AnySQLiteColumn => entities.id),
  },
  (t) => [index("entities_last_seen_idx").on(t.lastSeen)],
)

/** Shared by the hourly steps: when each last finished, and what it wants the next run to know. */
export const hourlyRuns = sqliteTable("hourly_runs", {
  step: text().primaryKey(),
  lastRunAt: integer().notNull(),
  detailJson: text({ mode: "json" }).$type<Record<string, number>>(),
})

export type Entity = typeof entities.$inferSelect
