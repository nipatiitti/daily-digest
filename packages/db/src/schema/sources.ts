import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { CATEGORIES, flag } from "./common.ts"

/** rss covers RSS, Atom and RDF; json and html need a `parser`. */
export const SOURCE_KINDS = ["rss", "json", "html"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** A = authoritative, B = discovery, C = down-weighted, D = signal only (boosts, never an origin). */
export const TIERS = ["A", "B", "C", "D"] as const
export type Tier = (typeof TIERS)[number]

export const PARSERS = ["kev", "euvd", "hf_trending", "hn_front_page", "bsky_trending", "html_diff"] as const
export type Parser = (typeof PARSERS)[number]

/** Item filter applied at fetch time. Patterns are case-insensitive regexes. */
export type SourceFilter = {
  categories?: string[]
  titlePattern?: string
  textPattern?: string
  /** How the conditions above combine. Default "all". */
  mode?: "all" | "any"
  /** html_diff: CSS selector of the list to diff. */
  selector?: string
  /** hf_trending: only model IDs owned by these orgs. */
  orgs?: string[]
}

export const sources = sqliteTable(
  "sources",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** Stable seed key. */
    slug: text().notNull().unique(),
    name: text().notNull(),
    url: text().notNull(),
    kind: text({ enum: SOURCE_KINDS }).notNull().default("rss"),
    parser: text({ enum: PARSERS }),
    filterJson: text({ mode: "json" }).$type<SourceFilter>(),
    tier: text({ enum: TIERS }).notNull(),
    category: text({ enum: CATEGORIES }).notNull(),
    lang: text().notNull().default("en"),
    authoritative: flag(),
    pollSeconds: integer().notNull(),
    staleAfterDays: integer().notNull().default(3),
    enabled: integer({ mode: "boolean" }).notNull().default(true),

    // Runtime state, never touched by the seed.
    nextPollAt: integer().notNull().default(0),
    etag: text(),
    lastModified: text(),
    lastStatus: integer(),
    consecutiveFailures: integer().notNull().default(0),
    lastNewItemAt: integer(),
  },
  (t) => [index("sources_due_idx").on(t.enabled, t.nextPollAt)],
)

export type Source = typeof sources.$inferSelect
