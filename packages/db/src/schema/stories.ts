import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { CATEGORIES, nowMs } from "./common.ts"

export const STORY_STATUSES = ["active", "closed", "merged"] as const
export type StoryStatus = (typeof STORY_STATUSES)[number]

export const RUBRIC_DIMENSIONS = [
  "severity",
  "specificity",
  "breadth",
  "actionability",
  "novelty",
  "credibility",
] as const
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number]

/** Raw 0–4 dimensions plus the caps that applied, so feedback can refit weights. */
export type Rubric = {
  dims: Record<RubricDimension, number>
  flags: { promotional: boolean; aggregator: boolean; evergreen: boolean }
  value: number
}

export const stories = sqliteTable(
  "stories",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    category: text({ enum: CATEGORIES }).notNull(),
    status: text({ enum: STORY_STATUSES }).notNull().default("active"),
    mergedInto: integer().references((): AnySQLiteColumn => stories.id),
    previousStoryId: integer().references((): AnySQLiteColumn => stories.id),
    title: text().notNull(),
    primaryEntity: text(),
    firstSeen: integer().notNull(),
    lastArticleAt: integer().notNull(),
    uniqueDomains: integer().notNull().default(0),
    independentOrigins: integer().notNull().default(0),
    authoritativeCount: integer().notNull().default(0),
    origins6h: integer("origins_6h").notNull().default(0),
    rubricJson: text({ mode: "json" }).$type<Rubric>(),
    score: real(),
    /** Score tier; crossing one makes an update material. */
    tier: integer(),
    /** 0–2 */
    fiRelevance: integer().notNull().default(0),
    /** Hash of the article set last extracted; keys the StoryEval workflow. */
    extractionHash: text(),
    summary: text(),
    whyMatters: text(),
  },
  (t) => [
    index("stories_status_last_article_idx").on(t.status, t.lastArticleAt),
    index("stories_merged_into_idx").on(t.mergedInto),
  ],
)

export const FACT_TYPES = [
  "severity",
  "scope",
  "attribution",
  "casualties",
  "patch_status",
  "exploitation",
  "other",
] as const
export type FactType = (typeof FACT_TYPES)[number]

/** A stored fact stays active until a later fact supersedes or contradicts it. */
export const FACT_STATUSES = ["active", "superseded", "contradicted"] as const
export type FactStatus = (typeof FACT_STATUSES)[number]

export const facts = sqliteTable(
  "facts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    storyId: integer()
      .notNull()
      .references(() => stories.id),
    text: text().notNull(),
    type: text({ enum: FACT_TYPES }).notNull(),
    salience: integer().notNull(),
    firstSeen: integer().notNull(),
    supportingArticleIdsJson: text({ mode: "json" }).$type<number[]>().notNull(),
    status: text({ enum: FACT_STATUSES }).notNull().default("active"),
  },
  (t) => [index("facts_story_first_seen_idx").on(t.storyId, t.firstSeen)],
)

export const vulns = sqliteTable("vulns", {
  cveId: text().primaryKey(),
  vendor: text(),
  product: text(),
  cnaCvss: real(),
  kevDateAdded: integer(),
  euvdExploitedSince: integer(),
  epss: real(),
  updatedAt: integer().notNull(),
})

export const storyVulns = sqliteTable(
  "story_vulns",
  {
    storyId: integer()
      .notNull()
      .references(() => stories.id),
    cveId: text()
      .notNull()
      .references(() => vulns.cveId),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.cveId] }), index("story_vulns_cve_idx").on(t.cveId)],
)

export const SIGNAL_KINDS = ["hn", "bsky", "gtrends", "mastodon", "sans", "kagi"] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]

export const signals = sqliteTable(
  "signals",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** Null until matched; an unmatched kagi signal is a missed story. */
    storyId: integer().references(() => stories.id),
    kind: text({ enum: SIGNAL_KINDS }).notNull(),
    value: real().notNull(),
    /** What was observed: an HN item, a trending topic, a Kagi cluster title. */
    ref: text(),
    observedAt: nowMs(),
  },
  (t) => [index("signals_story_idx").on(t.storyId), index("signals_kind_observed_idx").on(t.kind, t.observedAt)],
)

export const follows = sqliteTable("follows", {
  storyId: integer()
    .primaryKey()
    .references(() => stories.id),
  followedAt: nowMs(),
  expiresAt: integer().notNull(),
  lastReportedFactAt: integer(),
  active: integer({ mode: "boolean" }).notNull().default(true),
})

export type Story = typeof stories.$inferSelect
export type Fact = typeof facts.$inferSelect
