import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const ROLLUP_KINDS = ["desk", "stream", "source", "story", "entity", "theme"] as const
export type RollupKind = (typeof ROLLUP_KINDS)[number]

/** Counts per hour and subject, so a 90 day chart reads a few thousand rows instead of every article. */
export const rollups = sqliteTable(
  "rollups",
  {
    /** Unix ms, start of the hour. */
    bucket: integer().notNull(),
    kind: text({ enum: ROLLUP_KINDS }).notNull(),
    /** "desk", the category, or the source, story, entity or theme ID as text. */
    key: text().notNull(),
    articles: integer().notNull().default(0),
    origins: integer().notNull().default(0),
    newStories: integer().notNull().default(0),
    scoreSum: real().notNull().default(0),
    scoreN: integer().notNull().default(0),
    updatedAt: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.kind, t.key] }),
    index("rollups_kind_key_bucket_idx").on(t.kind, t.key, t.bucket),
  ],
)

export type Rollup = typeof rollups.$inferSelect
