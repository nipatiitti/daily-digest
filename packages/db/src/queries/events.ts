import { and, desc, eq, getTableColumns, gte, inArray, lt, lte, ne, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch, selectIn } from "../client.ts"
import {
  articleFacets,
  articles,
  deliveries,
  digestsShadow,
  entities,
  eventActors,
  eventArticles,
  eventCodes,
  eventEntities,
  events,
  eventThreads,
  type FacetEntityKind,
  interest,
  pairDecisions,
  relevance,
  sources,
} from "../schema/index.ts"

const memberChunk = (db: Db, ids: number[], asOf?: number) =>
  db
    .select({
      eventId: eventArticles.eventId,
      articleId: eventArticles.articleId,
      originArticleId: eventArticles.originArticleId,
      sourceId: articles.sourceId,
      sourceName: sources.name,
      sourceRole: sources.role,
      sourceCountry: sources.country,
      tier: sources.tier,
      domain: articles.domain,
      canonicalUrl: articles.canonicalUrl,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
      titleEn: articleFacets.titleEn,
      gist: articleFacets.gist,
      countries: articleFacets.countriesJson,
      advisory: articleFacets.advisory,
      roundup: articleFacets.roundup,
      promotional: articleFacets.promotional,
      eventType: articleFacets.eventType,
      entities: articleFacets.entitiesJson,
    })
    .from(eventArticles)
    .innerJoin(articles, eq(articles.id, eventArticles.articleId))
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .innerJoin(articleFacets, eq(articleFacets.articleId, eventArticles.articleId))
    .where(and(inArray(eventArticles.eventId, ids), asOf === undefined ? undefined : lte(articles.fetchedAt, asOf)))

export type EventMember = Awaited<ReturnType<typeof memberChunk>>[number]

/** The events' articles fetched at or before `asOf` (all without it), with links and facets, earliest published first. */
export const eventMembers = async (db: Db, eventIds: number[], asOf?: number): Promise<EventMember[]> =>
  (await selectIn(db, eventIds, 2, (chunk) => memberChunk(db, chunk, asOf))).sort(
    (a, b) => a.publishedAt - b.publishedAt || a.articleId - b.articleId,
  )

/** The event an id ends up in after following `merged_into`; null for an unknown id. */
export const resolveEventId = async (db: Db, id: number) => {
  const [row] = await db.all<{ id: number }>(sql`with recursive chain(id, next) as (
      select id, merged_into from events where id = ${id}
      union select e.id, e.merged_into from events e join chain c on e.id = c.next
    ) select id from chain where next is null`)
  return row?.id ?? null
}

/** Active events with no new article since `before` are closed; an article joining one reopens it. */
export const closeQuietEvents = async (db: Db, before: number) =>
  (
    await db
      .update(events)
      .set({ status: "closed" })
      .where(and(eq(events.status, "active"), lt(events.lastArticleAt, before)))
      .returning({ id: events.id })
  ).length

export const createEvent = async (db: Db, e: typeof events.$inferInsert) => {
  const [row] = await db.insert(events).values(e).returning({ id: events.id })
  if (!row) throw new Error("event insert returned no row")
  return row.id
}

/**
 * Place an article in an event, or in the event it was merged into since the caller read it (merges flatten chains,
 * so one hop is enough). Returns the event it went into.
 */
export const placeArticle = async (db: Db, row: typeof eventArticles.$inferInsert) => {
  const [placed] = await db
    .insert(eventArticles)
    .values({
      ...row,
      eventId: sql<number>`(select coalesce(${events.mergedInto}, ${events.id}) from ${events}
        where ${events.id} = ${row.eventId})`,
    })
    .returning({ eventId: eventArticles.eventId })
  if (!placed) throw new Error("event_articles insert returned no row")
  return placed.eventId
}

/**
 * Articles a run placed in an event while consolidation merged it away move on to the event it went into. Returns
 * the events that gained articles, to be recounted.
 */
export const repointMergedArticles = async (db: Db) => {
  const merged = db.select({ id: events.id }).from(events).where(eq(events.status, "merged"))
  const rows = await db
    .update(eventArticles)
    .set({
      eventId: sql`(select ${events.mergedInto} from ${events} where ${events.id} = ${eventArticles.eventId})`,
      how: "merge",
    })
    .where(inArray(eventArticles.eventId, merged))
    .returning({ eventId: eventArticles.eventId })
  return [...new Set(rows.map((r) => r.eventId))]
}

/** Counters and centroid for one event; never revives a merged one. A builder, for runBatch. */
export const updateEvent = (db: Db, id: number, set: Partial<typeof events.$inferInsert>) =>
  db
    .update(events)
    .set(set)
    .where(and(eq(events.id, id), ne(events.status, "merged")))

/** Where placed articles sit now (one `merged_into` hop), with the facets clustering compares. */
export const articleEvents = (db: Db, articleIds: number[]) =>
  selectIn(db, articleIds, 1, (chunk) =>
    db
      .select({
        articleId: eventArticles.articleId,
        eventId: sql<number>`coalesce(${events.mergedInto}, ${events.id})`,
        originArticleId: eventArticles.originArticleId,
        sourceId: articles.sourceId,
        titleEn: articleFacets.titleEn,
        entities: articleFacets.entitiesJson,
      })
      .from(eventArticles)
      .innerJoin(events, eq(events.id, eventArticles.eventId))
      .innerJoin(articles, eq(articles.id, eventArticles.articleId))
      .innerJoin(articleFacets, eq(articleFacets.articleId, eventArticles.articleId))
      .where(inArray(eventArticles.articleId, chunk)),
  )

const eventRow = {
  id: events.id,
  status: events.status,
  title: events.title,
  gist: events.gist,
  firstSeen: events.firstSeen,
  centroid: events.centroid,
  articleCount: events.articleCount,
}

export const eventRows = (db: Db, ids: number[]) =>
  selectIn(db, ids, 1, (chunk) => db.select(eventRow).from(events).where(inArray(events.id, chunk)))

export type EventRow = Awaited<ReturnType<typeof eventRows>>[number]

/** Active events first seen since `firstSeen` and updated since `updatedSince`, at most `limit`, newest updated first. */
export const recentEvents = (db: Db, o: { firstSeen: number; updatedSince: number; limit: number }) =>
  db
    .select(eventRow)
    .from(events)
    .where(and(eq(events.status, "active"), gte(events.firstSeen, o.firstSeen), gte(events.updatedAt, o.updatedSince)))
    .orderBy(desc(events.updatedAt), desc(events.id))
    .limit(o.limit)

/** Decisions on pairs whose smaller id is one of these. */
export const pairDecisionsAmong = (db: Db, ids: number[]) =>
  selectIn(db, ids, 1, (chunk) => db.select().from(pairDecisions).where(inArray(pairDecisions.aEventId, chunk)))

/** Records a same-event decision, smaller id first; a pair already decided keeps its first decision. */
export const savePairDecision = (db: Db, d: typeof pairDecisions.$inferInsert) =>
  db
    .insert(pairDecisions)
    .values({ ...d, aEventId: Math.min(d.aEventId, d.bEventId), bEventId: Math.max(d.aEventId, d.bEventId) })
    .onConflictDoNothing()

/** Rows of a link table move from one event to another unless the other already has that link. */
const moveLinks = (
  db: Db,
  table: typeof eventEntities | typeof eventThreads,
  other: string,
  from: number,
  into: number,
) => [
  db
    .update(table)
    .set({ eventId: into })
    .where(
      and(
        eq(table.eventId, from),
        sql`${sql.identifier(other)} not in (select ${sql.identifier(other)} from ${table} where event_id = ${into})`,
      ),
    ),
  db.delete(table).where(eq(table.eventId, from)),
]

/**
 * Fold one event into another: articles, entity and thread links, deliveries and shadow items move, the younger's
 * relevance and interest rows and both codes go, and it is marked merged with zero counters. The caller recomputes
 * the target's counters.
 */
export const mergeEvents = (db: Db, fromId: number, intoId: number, now: number) =>
  runBatch(db, [
    db.update(eventArticles).set({ eventId: intoId, how: "merge" }).where(eq(eventArticles.eventId, fromId)),
    ...moveLinks(db, eventEntities, "entity_id", fromId, intoId),
    ...moveLinks(db, eventThreads, "thread_id", fromId, intoId),
    db.update(deliveries).set({ eventId: intoId }).where(eq(deliveries.eventId, fromId)),
    db.update(digestsShadow).set({ eventId: intoId }).where(eq(digestsShadow.eventId, fromId)),
    db.delete(relevance).where(eq(relevance.eventId, fromId)),
    db.delete(interest).where(eq(interest.eventId, fromId)),
    // The survivor is coded again from its new members, so both codes go.
    db.delete(eventActors).where(inArray(eventActors.eventId, [fromId, intoId])),
    db.delete(eventCodes).where(inArray(eventCodes.eventId, [fromId, intoId])),
    db.update(events).set({ mergedInto: intoId }).where(eq(events.mergedInto, fromId)),
    db
      .update(events)
      .set({
        status: "merged",
        mergedInto: intoId,
        articleCount: 0,
        independentOrigins: 0,
        uniqueSources: 0,
        officialCount: 0,
        origins6h: 0,
        updatedAt: now,
      })
      .where(eq(events.id, fromId)),
  ])

/**
 * Insert entities named by facets and widen the seen range of existing ones. A v1 kind of `other`, or `org`, gives
 * way to a more specific facet kind, never the reverse. Returns each key's entity, following a manual merge.
 */
export const upsertFacetEntities = async (
  db: Db,
  rows: { key: string; name: string; kind: FacetEntityKind; firstSeen: number; lastSeen: number }[],
) => {
  const results = await runBatch(
    db,
    chunkRows(rows, Object.keys(getTableColumns(entities)).length).map((chunk) =>
      db
        .insert(entities)
        .values(chunk)
        .onConflictDoUpdate({
          target: entities.key,
          set: {
            kind: sql`case when ${entities.kind} = 'other' or (${entities.kind} = 'org' and excluded.kind <> 'org')
              then excluded.kind else ${entities.kind} end`,
            firstSeen: sql`min(${entities.firstSeen}, excluded.first_seen)`,
            lastSeen: sql`max(${entities.lastSeen}, excluded.last_seen)`,
          },
        })
        .returning({ key: entities.key, id: sql<number>`coalesce(${entities.mergedInto}, ${entities.id})` }),
    ),
  )
  return new Map((results as { key: string; id: number }[][]).flat().map((r) => [r.key, r.id]))
}

/** Write each link's mentions as counted from the event's members, then recount the entities' unmerged events. */
export const linkEventEntities = async (db: Db, links: (typeof eventEntities.$inferInsert)[]) => {
  const entityIds = [...new Set(links.map((l) => l.entityId))]
  await runBatch(db, [
    ...chunkRows(links, Object.keys(getTableColumns(eventEntities)).length).map((chunk) =>
      db
        .insert(eventEntities)
        .values(chunk)
        .onConflictDoUpdate({
          target: [eventEntities.eventId, eventEntities.entityId],
          set: { mentions: sql`excluded.mentions`, firstSeen: sql`excluded.first_seen` },
        }),
    ),
    ...chunkRows(entityIds, 1).map((ids) =>
      db
        .update(entities)
        .set({
          eventCount: sql`(select count(*) from ${eventEntities} inner join ${events}
            on ${events.id} = ${eventEntities.eventId}
            where ${eventEntities.entityId} = ${entities.id} and ${events.status} != 'merged')`,
        })
        .where(inArray(entities.id, ids)),
    ),
  ])
}
