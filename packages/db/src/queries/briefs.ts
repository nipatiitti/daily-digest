import { and, type Column, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { type BriefMover, briefs, rollups, stories, themes } from "../schema/index.ts"
import { themeStreams } from "./dashboard.ts"

export const insertBrief = async (db: Db, row: typeof briefs.$inferInsert) => {
  const [inserted] = await db.insert(briefs).values(row).returning({ id: briefs.id })
  if (!inserted) throw new Error("Brief insert returned no row")
  return inserted.id
}

export const latestBrief = async (db: Db) => {
  const [row] = await db.select().from(briefs).orderBy(desc(briefs.at)).limit(1)
  return row ?? null
}

/** Briefs written in [from, to), newest first. */
export const briefsBetween = (db: Db, from: number, to: number, limit?: number) => {
  const q = db
    .select()
    .from(briefs)
    .where(and(gte(briefs.at, from), lt(briefs.at, to)))
    .orderBy(desc(briefs.at))
  return limit === undefined ? q : q.limit(limit)
}

/** Articles in [from, to) through a subject's hourly rollups. */
const articlesIn = (kind: "story" | "theme", id: Column, from: number, to: number) =>
  sql<number>`(select coalesce(sum(${rollups.articles}), 0) from ${rollups} where ${rollups.kind} = ${kind}
    and ${rollups.key} = cast(${id} as text) and ${rollups.bucket} >= ${from} and ${rollups.bucket} < ${to})`

const largestSwing = (momentum: Column) => desc(sql`abs(${momentum})`)

/**
 * Active signals and stories with the largest stored 24 hour momentum either way, among those with at least
 * `minArticles` articles in [from, to), the momentum window. A rise from 0 (null) has no size and is left out.
 */
export const briefMovers = async (db: Db, o: { from: number; to: number; minArticles: number; limit: number }) => {
  const themeArticles = articlesIn("theme", themes.id, o.from, o.to)
  const storyArticles = articlesIn("story", stories.id, o.from, o.to)
  const [themeRows, storyRows] = await Promise.all([
    db
      .select({ id: themes.id, name: themes.name, m: themes.momentum24h, n: themeArticles, stories: themes.storyCount })
      .from(themes)
      .where(and(eq(themes.status, "active"), isNotNull(themes.momentum24h), gte(themeArticles, o.minArticles)))
      .orderBy(largestSwing(themes.momentum24h))
      .limit(o.limit),
    db
      .select({ id: stories.id, name: stories.title, cat: stories.category, m: stories.momentum24h, n: storyArticles })
      .from(stories)
      .where(
        and(
          eq(stories.status, "active"),
          gte(stories.lastArticleAt, o.from),
          isNotNull(stories.momentum24h),
          gte(storyArticles, o.minArticles),
        ),
      )
      .orderBy(largestSwing(stories.momentum24h))
      .limit(o.limit),
  ])
  const streams = await themeStreams(
    db,
    themeRows.map((t) => t.id),
  )
  const themeStream = (id: number) =>
    streams
      .filter((s) => s.themeId === id)
      .map((s) => s.category)
      .join(", ")
  const movers: BriefMover[] = [
    ...themeRows.map(({ m, n, ...t }) => ({
      ...t,
      kind: "theme" as const,
      stream: themeStream(t.id),
      momentum24h: m ?? 0,
      articles24h: n,
    })),
    ...storyRows.map(({ m, n, cat, ...s }) => ({
      ...s,
      kind: "story" as const,
      stream: cat,
      momentum24h: m ?? 0,
      articles24h: n,
      stories: null,
    })),
  ]
  return movers.sort((a, b) => Math.abs(b.momentum24h) - Math.abs(a.momentum24h)).slice(0, o.limit)
}

/**
 * Active signals whose 24 hour momentum moved at least `bandPct` percentage points from the momentum stored with their
 * explanation, or that have none, the largest swing since the last explanation first. A rise from 0 (null) now is
 * never due.
 */
export const themesToExplain = (db: Db, o: { bandPct: number; limit: number }) => {
  const swing = sql`coalesce(abs(${themes.momentum24h} - ${themes.explainedMomentum24h}), 1e9)`
  return db
    .select({ id: themes.id, name: themes.name, description: themes.description, momentum24h: themes.momentum24h })
    .from(themes)
    .where(and(eq(themes.status, "active"), isNotNull(themes.momentum24h), sql`${swing} >= ${o.bandPct}`))
    .orderBy(desc(swing))
    .limit(o.limit)
}
