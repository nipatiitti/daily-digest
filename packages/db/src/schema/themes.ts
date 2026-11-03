import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { nowMs, vector } from "./common.ts"
import { stories } from "./stories.ts"

/** Provisional themes are hidden until they have enough stories; closed ones reopen when a story joins. */
export const THEME_STATUSES = ["provisional", "active", "closed", "merged"] as const
export type ThemeStatus = (typeof THEME_STATUSES)[number]

export const THEME_EVENT_KINDS = [
  "created",
  "renamed",
  "merged",
  "closed",
  "reopened",
  "promoted",
  "assigned",
  "detached",
] as const
export type ThemeEventKind = (typeof THEME_EVENT_KINDS)[number]

/** A named development several stories share over days or weeks; the dashboard calls them signals. */
export const themes = sqliteTable(
  "themes",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull(),
    /** One sentence. */
    description: text().notNull(),
    status: text({ enum: THEME_STATUSES }).notNull().default("provisional"),
    /** Set by a merge; new links go to this theme instead. */
    mergedInto: integer().references((): AnySQLiteColumn => themes.id),
    /** bge-m3 vector (1024 float32) of the founding story's headline and summary. */
    embedding: vector().notNull(),
    firstSeen: integer().notNull(),
    /** Latest story assignment. */
    lastSeen: integer().notNull(),
    /** Unmerged stories linked to it. */
    storyCount: integer().notNull().default(0),
    momentum24h: real("momentum_24h"),
    momentum7d: real("momentum_7d"),
    explanation: text(),
    explainedAt: integer(),
    /** `momentum24h` when the explanation was written; the brief explains again once it moves a band away. */
    explainedMomentum24h: real("explained_momentum_24h"),
  },
  (t) => [index("themes_status_last_seen_idx").on(t.status, t.lastSeen), index("themes_last_seen_idx").on(t.lastSeen)],
)

export const storyThemes = sqliteTable(
  "story_themes",
  {
    storyId: integer()
      .notNull()
      .references(() => stories.id),
    themeId: integer()
      .notNull()
      .references(() => themes.id),
    /** 0 to 1, from the model that assigned it; 1 for a manual link. */
    confidence: real().notNull(),
    assignedAt: nowMs(),
    /** Model ID, or `manual`. */
    by: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.themeId] }), index("story_themes_theme_idx").on(t.themeId)],
)

export const themeEvents = sqliteTable(
  "theme_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    themeId: integer()
      .notNull()
      .references(() => themes.id),
    kind: text({ enum: THEME_EVENT_KINDS }).notNull(),
    detailJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    at: nowMs(),
  },
  (t) => [index("theme_events_theme_at_idx").on(t.themeId, t.at)],
)

export type Theme = typeof themes.$inferSelect
export type StoryTheme = typeof storyThemes.$inferSelect
export type ThemeEvent = typeof themeEvents.$inferSelect
