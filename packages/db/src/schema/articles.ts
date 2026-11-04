import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { flag } from "./common.ts"
import { sources } from "./sources.ts"

export const articles = sqliteTable(
  "articles",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sourceId: integer()
      .notNull()
      .references(() => sources.id),
    guid: text().notNull(),
    canonicalUrl: text().notNull().unique(),
    domain: text().notNull(),
    title: text().notNull(),
    snippet: text(),
    lang: text(),
    publishedAt: integer().notNull(),
    fetchedAt: integer().notNull(),
    embeddedAt: integer(),
    fulltextR2Key: text("fulltext_r2_key"),
    cveIdsJson: text({ mode: "json" }).$type<string[]>(),
    entitiesJson: text({ mode: "json" }).$type<string[]>(),
    isPromotional: flag(),
    isAggregator: flag(),
    injectionSuspect: flag(),
  },
  (t) => [unique("articles_source_guid_uq").on(t.sourceId, t.guid), index("articles_published_idx").on(t.publishedAt)],
)

export type Article = typeof articles.$inferSelect
export type NewArticle = typeof articles.$inferInsert
