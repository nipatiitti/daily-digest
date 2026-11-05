import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { articles } from "./articles.ts"
import { flag, nowMs, vector } from "./common.ts"
import { entities } from "./entities.ts"

export const FACET_ENTITY_KINDS = ["person", "org", "place", "product", "topic"] as const
export type FacetEntityKind = (typeof FACET_ENTITY_KINDS)[number]

/** A named thing the article is about. Never the outlet that published it. */
export type FacetEntity = { name: string; kind: FacetEntityKind }

export const EVENT_TYPES = [
  "politics",
  "election",
  "conflict",
  "diplomacy",
  "economy",
  "business",
  "technology",
  "science",
  "health",
  "disaster",
  "accident",
  "crime",
  "cyberattack",
  "vulnerability",
  "legal",
  "society",
  "sport",
  "culture",
  "other",
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** One cheap Haiku pass per article at ingest; `model` is "code" for the fallback written without an LLM. */
export const articleFacets = sqliteTable(
  "article_facets",
  {
    articleId: integer()
      .primaryKey()
      .references(() => articles.id),
    /** The headline in English. */
    titleEn: text().notNull(),
    /** One English sentence on what happened; this, with the title, is what gets embedded. */
    gist: text().notNull(),
    entitiesJson: text({ mode: "json" }).$type<FacetEntity[]>().notNull(),
    /** ISO 3166-1 alpha-2 codes of the countries the text is about, never the outlet's home. */
    countriesJson: text({ mode: "json" }).$type<string[]>().notNull(),
    eventType: text({ enum: EVENT_TYPES }).notNull(),
    /** A vulnerability or product advisory, one item per CVE or patch. */
    advisory: flag(),
    opinion: flag(),
    /** A digest or roundup of several unrelated items. */
    roundup: flag(),
    promotional: flag(),
    model: text().notNull(),
    facetedAt: nowMs(),
    /** Set once the gist vector is in the `digest-gists` index. */
    embeddedAt: integer(),
  },
  (t) => [index("article_facets_embedded_idx").on(t.embeddedAt)],
)

export const EVENT_STATUSES = ["active", "closed", "merged"] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/** One real-world happening, clustered from article gists. Counters are written by code, never by a model. */
export const events = sqliteTable(
  "events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    status: text({ enum: EVENT_STATUSES }).notNull().default("active"),
    /** Set by a consolidation merge; the merged event's articles moved here. */
    mergedInto: integer().references((): AnySQLiteColumn => events.id),
    /** English title and gist of the earliest origin article, until digest copy is written. */
    title: text().notNull(),
    gist: text().notNull(),
    /** Mean of the member articles' gist vectors (1024 float32), kept as articles join. */
    centroid: vector().notNull(),
    firstSeen: integer().notNull(),
    lastArticleAt: integer().notNull(),
    articleCount: integer().notNull().default(0),
    /** Distinct outlets among the independent origins (not wire copies, roundups, promotions or aggregators). */
    independentOrigins: integer().notNull().default(0),
    /** Distinct sources among the members: outlet diversity. */
    uniqueSources: integer().notNull().default(0),
    /** Distinct sources with role `official` among the members. */
    officialCount: integer().notNull().default(0),
    /** Outlets with an independent origin in the 6 hours up to the latest article: velocity. */
    origins6h: integer("origins_6h").notNull().default(0),
    /** Every origin comes from a source with role `advisory` or is flagged an advisory. */
    advisoryOnly: flag(),
    /** Countries involved, most mentioned first, from the members' facets. */
    countriesJson: text({ mode: "json" }).$type<string[]>().notNull(),
    /** The members' most common event type. */
    eventType: text({ enum: EVENT_TYPES }).notNull(),
    /** Digest copy by Sonnet, written only for picked events; `copyHash` is the article set it was written from. */
    headline: text(),
    summary: text(),
    whyForYou: text(),
    copyHash: text(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    index("events_status_last_article_idx").on(t.status, t.lastArticleAt),
    index("events_first_seen_idx").on(t.firstSeen),
    index("events_merged_into_idx").on(t.mergedInto),
  ],
)

/** How ingest placed an article; `merge` when consolidation moved it, `fallback-*` the ask band without an LLM. */
export const EVENT_HOWS = [
  "new",
  "join",
  "copy",
  "ask-yes",
  "ask-no",
  "fallback-join",
  "fallback-new",
  "merge",
] as const
export type EventHow = (typeof EVENT_HOWS)[number]

/** One row per placed article: membership and the placement log in one, for calibrating CLUSTER. */
export const eventArticles = sqliteTable(
  "event_articles",
  {
    articleId: integer()
      .primaryKey()
      .references(() => articles.id),
    eventId: integer()
      .notNull()
      .references(() => events.id),
    /** The member this one is a wire copy of; null when it is an origin. */
    originArticleId: integer().references(() => articles.id),
    how: text({ enum: EVENT_HOWS }).notNull(),
    /** Similarity of the best candidate event, after the same-source penalty and entity boost. */
    cosine: real(),
    /** Best candidate event considered, even when a new event was started. */
    candidateEventId: integer().references(() => events.id),
    at: nowMs(),
  },
  (t) => [index("event_articles_event_idx").on(t.eventId), index("event_articles_origin_idx").on(t.originArticleId)],
)

/** Entities named by an event's articles' facets. */
export const eventEntities = sqliteTable(
  "event_entities",
  {
    eventId: integer()
      .notNull()
      .references(() => events.id),
    entityId: integer()
      .notNull()
      .references(() => entities.id),
    /** Member articles naming it. */
    mentions: integer().notNull().default(1),
    /** The event's first-seen time. */
    firstSeen: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.entityId] }), index("event_entities_entity_idx").on(t.entityId)],
)

/** Every same-event decision on a pair, so no pair is asked twice. `aEventId` is the smaller id. */
export const pairDecisions = sqliteTable(
  "pair_decisions",
  {
    aEventId: integer()
      .notNull()
      .references(() => events.id),
    bEventId: integer()
      .notNull()
      .references(() => events.id),
    same: integer({ mode: "boolean" }).notNull(),
    cosine: real(),
    /** Model ID, `copy` for a wire copy or title match, or `manual`. */
    by: text().notNull(),
    at: nowMs(),
  },
  (t) => [primaryKey({ columns: [t.aEventId, t.bEventId] })],
)

export type ArticleFacets = typeof articleFacets.$inferSelect
export type Event = typeof events.$inferSelect
export type EventArticle = typeof eventArticles.$inferSelect
