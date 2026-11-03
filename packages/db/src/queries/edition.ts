import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { chunkRows, type Db, runBatch, selectIn } from "../client.ts"
import {
  articles,
  deliveries,
  digests,
  digestsShadow,
  entities,
  eventArticles,
  eventEntities,
  events,
  eventThreads,
  relevance,
  type ShadowMode,
  stories,
  threads,
} from "../schema/index.ts"
import { lastRun, markRun } from "./entities.ts"

/** Rows grouped by their event, keeping their order. */
export const byEvent = <T extends { eventId: number }>(rows: T[]) => {
  const out = new Map<number, T[]>()
  for (const r of rows) {
    const list = out.get(r.eventId)
    if (list) list.push(r)
    else out.set(r.eventId, [r])
  }
  return out
}

/**
 * Events with no relevance row for this profile version, or whose independent origins reached `factor` times those
 * at that score: active ones with an article since `since`, or the given unmerged ones whatever their age.
 */
export const relevanceTargets = async (
  db: Db,
  version: number,
  factor: number,
  o: { since: number } | { eventIds: number[] },
) => {
  const due = (which: SQL | undefined) =>
    db
      .select({
        id: events.id,
        title: events.title,
        gist: events.gist,
        countries: events.countriesJson,
        eventType: events.eventType,
        advisoryOnly: events.advisoryOnly,
        independentOrigins: events.independentOrigins,
        officialCount: events.officialCount,
        lastArticleAt: events.lastArticleAt,
      })
      .from(events)
      .leftJoin(relevance, and(eq(relevance.eventId, events.id), eq(relevance.profileVersion, version)))
      .where(
        and(
          which,
          or(isNull(relevance.eventId), gte(events.independentOrigins, sql`${factor} * ${relevance.originsAtScore}`)),
        ),
      )
  if ("since" in o) return due(and(eq(events.status, "active"), gte(events.lastArticleAt, o.since)))
  return selectIn(db, o.eventIds, 2, (chunk) => due(and(inArray(events.id, chunk), ne(events.status, "merged"))))
}

/** Each event's unmerged threads, the highest confidence (its primary thread) first. */
export const eventThreadLinks = async (db: Db, ids: number[]) =>
  byEvent(
    await selectIn(db, ids, 2, (chunk) =>
      db
        .select({ eventId: eventThreads.eventId, threadId: threads.id, name: threads.name, status: threads.status })
        .from(eventThreads)
        .innerJoin(threads, eq(threads.id, eventThreads.threadId))
        .where(and(inArray(eventThreads.eventId, chunk), gt(eventThreads.confidence, 0), ne(threads.status, "merged")))
        .orderBy(desc(eventThreads.confidence), threads.id),
    ),
  )

/** Each event's entities, most mentioned first. */
export const eventEntityLinks = async (db: Db, ids: number[]) =>
  byEvent(
    await selectIn(db, ids, 2, (chunk) =>
      db
        .select({ eventId: eventEntities.eventId, entityId: entities.id, key: entities.key, name: entities.name })
        .from(eventEntities)
        .innerJoin(entities, eq(entities.id, eventEntities.entityId))
        .where(inArray(eventEntities.eventId, chunk))
        .orderBy(desc(eventEntities.mentions), entities.id),
    ),
  )

/** Each event's relevance row from the highest profile version that scored it. */
export const latestRelevance = async (db: Db, ids: number[]) => {
  const rows = await selectIn(db, ids, 2, (chunk) =>
    db
      .select({ eventId: relevance.eventId, score: relevance.score, reason: relevance.reason })
      .from(relevance)
      .where(inArray(relevance.eventId, chunk))
      .orderBy(relevance.profileVersion),
  )
  return new Map(rows.map((r) => [r.eventId, r]))
}

export const saveRelevance = (db: Db, rows: (typeof relevance.$inferInsert)[]) =>
  runBatch(
    db,
    chunkRows(rows, Object.keys(getTableColumns(relevance)).length).map((chunk) =>
      db
        .insert(relevance)
        .values(chunk)
        .onConflictDoUpdate({
          target: [relevance.eventId, relevance.profileVersion],
          set: {
            score: sql`excluded.score`,
            reason: sql`excluded.reason`,
            originsAtScore: sql`excluded.origins_at_score`,
            llmCallId: sql`excluded.llm_call_id`,
            at: sql`excluded.at`,
          },
        }),
    ),
  )

/**
 * Events with a member placed (`by` "placed") or fetched (`by` "fetched", for a replay) after `since` and at or
 * before `until`, counting only members fetched by `until`.
 */
export const changedEvents = async (db: Db, since: number, until: number, by: "placed" | "fetched") => {
  const at = by === "placed" ? eventArticles.at : articles.fetchedAt
  return (
    await db
      .selectDistinct({ id: eventArticles.eventId })
      .from(eventArticles)
      .innerJoin(articles, eq(articles.id, eventArticles.articleId))
      .where(and(gt(at, since), lte(at, until), lte(articles.fetchedAt, until)))
  ).map((r) => r.id)
}

/** When the latest sent edition started; null before the first. */
export const previousSentStart = async (db: Db) => {
  const [row] = await db
    .select({ at: sql<number | null>`max(${digests.startedAt})` })
    .from(digests)
    .where(eq(digests.status, "sent"))
  return row?.at ?? null
}

const shadowStep = (mode: ShadowMode) => `digest-v2-${mode}`

/** The latest `limit` editions of this shadow mode computed before `before`, newest first, empty ones included. */
export const shadowEditions = async (db: Db, mode: ShadowMode, before: number, limit: number) =>
  Object.entries((await lastRun(db, shadowStep(mode)))?.detailJson ?? {})
    .flatMap(([key, asOf]) => (asOf < before ? [{ key, asOf }] : []))
    .sort((a, b) => b.asOf - a.asOf)
    .slice(0, limit)

/**
 * Records a shadow edition run, whatever it picked, as hourly_runs step `digest-v2-<mode>`, whose detail maps the
 * latest `keep` edition keys to their asOf. Editions after this one are dropped: a replay rerun rewrites them in order.
 */
export const markShadowEdition = async (db: Db, mode: ShadowMode, key: string, asOf: number, keep: number) => {
  const earlier = (await shadowEditions(db, mode, asOf, keep)).filter((e) => e.key !== key)
  const kept = earlier.slice(0, Math.max(keep, 1) - 1).map((e) => [e.key, e.asOf] as const)
  await markRun(db, shadowStep(mode), asOf, Object.fromEntries([...kept, [key, asOf]]))
}

/** The latest shadow edition of this mode computed before `before`; null before the first. */
export const previousShadowAsOf = async (db: Db, mode: ShadowMode, before: number) =>
  (await shadowEditions(db, mode, before, 1))[0]?.asOf ?? null

/** For a v1 delivery, the event holding most of its story's articles. */
const storyEvent = sql<number | null>`(select ${eventArticles.eventId} from ${eventArticles}
  join ${articles} on ${articles.id} = ${eventArticles.articleId}
  where ${articles.storyId} = ${deliveries.storyId} group by 1 order by count(*) desc limit 1)`

/**
 * The given events already sent: any delivery, or holding most of a v1-delivered story's articles, for "send"; an
 * earlier shadow edition of the same mode otherwise.
 */
export const sentEvents = async (db: Db, mode: "send" | ShadowMode, ids: number[], before: number) => {
  if (mode !== "send") {
    const rows = await selectIn(db, ids, 2, (chunk) =>
      db
        .selectDistinct({ id: digestsShadow.eventId })
        .from(digestsShadow)
        .where(
          and(eq(digestsShadow.mode, mode), lt(digestsShadow.asOf, before), inArray(digestsShadow.eventId, chunk)),
        ),
    )
    return new Set(rows.map((r) => r.id))
  }
  const [v2, v1] = await Promise.all([
    selectIn(db, ids, 2, (chunk) =>
      db.selectDistinct({ id: deliveries.eventId }).from(deliveries).where(inArray(deliveries.eventId, chunk)),
    ),
    db
      .select({ id: storyEvent })
      .from(deliveries)
      .where(and(isNotNull(deliveries.storyId), isNull(deliveries.eventId)))
      .groupBy(deliveries.storyId),
  ])
  return new Set([...v2, ...v1].flatMap((r) => (r.id === null ? [] : [r.id])))
}

const headline = sql<string>`coalesce(${events.headline}, ${events.title})`

/**
 * Items with a thread in the latest `editions` editions of this mode before `before`, newest first, with the event's
 * headline and its independent origins when sent (counted as of the shadow edition for shadow modes). A v1 delivery
 * counts with the primary thread of the event holding most of its story's articles.
 */
export const recentThreadItems = async (
  db: Db,
  mode: "send" | ShadowMode,
  before: number,
  editions: number,
): Promise<{ threadId: number | null; headline: string; origins: number }[]> => {
  if (mode === "send") {
    const recent = db
      .select({ key: digests.digestDate })
      .from(digests)
      .where(and(eq(digests.status, "sent"), lt(digests.sentAt, before)))
      .orderBy(desc(digests.sentAt))
      .limit(editions)
    const rows = await db
      .select({
        eventId: sql<number | null>`coalesce(${deliveries.eventId}, ${storyEvent})`,
        threadId: deliveries.threadId,
        headline: sql<string>`coalesce(${events.headline}, ${events.title}, ${stories.title}, '')`,
        origins: sql<number>`coalesce(${deliveries.originsAtSend}, 0)`,
      })
      .from(deliveries)
      .leftJoin(events, eq(events.id, deliveries.eventId))
      .leftJoin(stories, eq(stories.id, deliveries.storyId))
      .where(
        and(inArray(deliveries.digestDate, recent), or(isNotNull(deliveries.eventId), isNotNull(deliveries.storyId))),
      )
      .orderBy(desc(deliveries.sentAt))
    const primary = await eventThreadLinks(
      db,
      rows.flatMap((r) => (r.threadId === null && r.eventId !== null ? [r.eventId] : [])),
    )
    return rows.flatMap((r) => {
      const threadId = r.threadId ?? (r.eventId === null ? null : (primary.get(r.eventId)?.[0]?.threadId ?? null))
      return threadId === null ? [] : [{ threadId, headline: r.headline, origins: r.origins }]
    })
  }
  const keys = (await shadowEditions(db, mode, before, editions)).map((e) => e.key)
  return db
    .select({
      threadId: digestsShadow.threadId,
      headline,
      origins: sql<number>`(select count(*) from ${eventArticles}
        inner join ${articles} on ${articles.id} = ${eventArticles.articleId}
        where ${eventArticles.eventId} = ${digestsShadow.eventId} and ${eventArticles.originArticleId} is null
        and ${articles.fetchedAt} <= ${digestsShadow.asOf})`,
    })
    .from(digestsShadow)
    .innerJoin(events, eq(events.id, digestsShadow.eventId))
    .where(
      and(eq(digestsShadow.mode, mode), inArray(digestsShadow.editionKey, keys), isNotNull(digestsShadow.threadId)),
    )
    .orderBy(desc(digestsShadow.asOf), digestsShadow.rank)
}

/** A rerun of a shadow edition replaces its rows. */
export const clearShadow = (db: Db, key: string, mode: ShadowMode) =>
  db.delete(digestsShadow).where(and(eq(digestsShadow.editionKey, key), eq(digestsShadow.mode, mode)))

export const saveShadow = (db: Db, rows: (typeof digestsShadow.$inferInsert)[]) =>
  runBatch(
    db,
    chunkRows(rows, Object.keys(getTableColumns(digestsShadow)).length).map((chunk) =>
      db.insert(digestsShadow).values(chunk),
    ),
  )

/** The stored digest copy per event, with the article set hash it was written from. */
export const eventCopyRows = async (db: Db, ids: number[]) =>
  new Map(
    (
      await selectIn(db, ids, 2, (chunk) =>
        db
          .select({
            id: events.id,
            headline: events.headline,
            summary: events.summary,
            whyForYou: events.whyForYou,
            copyHash: events.copyHash,
          })
          .from(events)
          .where(inArray(events.id, chunk)),
      )
    ).map((r) => [r.id, r]),
  )
