import { type AnyColumn, and, desc, eq, gte, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  articleFacets,
  deliveries,
  digestsShadow,
  entities,
  eventArticles,
  eventEntities,
  events,
  eventThreads,
  feedback,
  type MoverKind,
  movers,
  type ProfileFollows,
  type RollupKind,
  relevance,
  stories,
  type ThreadStatus,
  threads,
} from "../schema/index.ts"
import { rollupBuckets } from "./rollups.ts"
import { storyExamples } from "./stories.ts"

/** Threads the reader pages show; provisional ones only behind the list's toggle. */
export const SHOWN_THREADS: ThreadStatus[] = ["active", "closed"]

/** Conditions on `events`: linked to a thread, to an entity, or naming a country (`value`), matching `c`. */
const inThreads = (c: SQL) => sql`${events.id} in (select ${eventThreads.eventId} from ${eventThreads} where ${c})`
const inEntities = (c: SQL) => sql`${events.id} in (select ${eventEntities.eventId} from ${eventEntities}
  join ${entities} on ${entities.id} = ${eventEntities.entityId} where ${c})`
const inCountries = (c: SQL) => sql`exists (select 1 from json_each(${events.countriesJson}) where ${c})`

/** The events of a thread (its ID), an entity (its ID) or a country (ISO code), as a condition on `events`. */
export const subjectEvents = (kind: MoverKind, id: string): SQL =>
  kind === "thread"
    ? inThreads(eq(eventThreads.threadId, Number(id)))
    : kind === "entity"
      ? inEntities(eq(entities.id, Number(id)))
      : inCountries(sql`value = ${id}`)

/** The events linked to any followed thread, entity or country; undefined when nothing is followed. */
// One bound parameter per follow; PROFILE.maxFollows, enforced in setFollow, keeps the total under D1's 100.
const followedEvents = (f: ProfileFollows) => {
  const any = [
    f.threads.length ? inThreads(inArray(eventThreads.threadId, f.threads)) : undefined,
    f.entities.length ? inEntities(inArray(entities.key, f.entities)) : undefined,
    f.countries.length ? inCountries(sql`value in ${f.countries}`) : undefined,
  ].filter((c) => c !== undefined)
  return any.length ? or(...any) : undefined
}

/** The latest relevance row of the event in the current row, by profile version. */
const latest = sql`from ${relevance} where ${relevance.eventId} = ${events.id}
  order by ${relevance.profileVersion} desc limit 1`

/** Unmerged events matching `where`, newest first, with the latest relevance score and reason. */
export const readEvents = (db: Db, where: SQL | undefined, limit: number) =>
  db
    .select({
      id: events.id,
      title: sql<string>`coalesce(${events.headline}, ${events.title})`,
      gist: events.gist,
      firstSeen: events.firstSeen,
      lastArticleAt: events.lastArticleAt,
      independentOrigins: events.independentOrigins,
      officialCount: events.officialCount,
      countries: events.countriesJson,
      score: sql<number | null>`(select ${relevance.score} ${latest})`,
      reason: sql<string | null>`(select ${relevance.reason} ${latest})`,
    })
    .from(events)
    .where(and(ne(events.status, "merged"), where))
    .orderBy(desc(events.firstSeen))
    .limit(limit)

export type ReaderEvent = Awaited<ReturnType<typeof readEvents>>[number]

/** Events first seen since `since` in anything the profile follows; empty when it follows nothing. */
export const readFollowedSince = (db: Db, follows: ProfileFollows, since: number, limit: number) => {
  const where = followedEvents(follows)
  return where ? readEvents(db, and(gte(events.firstSeen, since), where), limit) : Promise.resolve([])
}

/** Shown threads, entities and countries most shared among the events matching `where`, most events first. */
export const readRelated = async (db: Db, where: SQL, limit: number) => {
  const ids = db
    .select({ id: events.id })
    .from(events)
    .where(and(ne(events.status, "merged"), where))
  const n = sql`count(*)`
  const [threadRows, entityRows, countryRows] = await Promise.all([
    db
      .select({ id: threads.id, name: threads.name })
      .from(eventThreads)
      .innerJoin(threads, eq(threads.id, eventThreads.threadId))
      .where(and(inArray(eventThreads.eventId, ids), inArray(threads.status, SHOWN_THREADS)))
      .groupBy(threads.id)
      .orderBy(desc(n))
      .limit(limit),
    db
      .select({ key: entities.key, name: entities.name, kind: entities.kind })
      .from(eventEntities)
      .innerJoin(entities, eq(entities.id, eventEntities.entityId))
      .where(and(inArray(eventEntities.eventId, ids), isNull(entities.mergedInto)))
      .groupBy(entities.id)
      .orderBy(desc(n))
      .limit(limit),
    db.all<{ code: string }>(sql`select c.value as code from ${events}, json_each(${events.countriesJson}) c
      where ${events.status} != 'merged' and ${where} group by c.value order by count(*) desc limit ${limit}`),
  ])
  return { threads: threadRows, entities: entityRows, countries: countryRows.map((r) => r.code) }
}

const up = sql<number>`count(case when ${feedback.vote} = 'up' then 1 end)`
const down = sql<number>`count(case when ${feedback.vote} = 'down' then 1 end)`
const firstSent = sql<number>`min(${deliveries.sentAt})`

/** Deliveries of the events matching `where`, one row per event, edition and kind whatever the chats, with votes. */
export const readDeliveries = (db: Db, where: SQL, limit: number) =>
  db
    .select({
      eventId: events.id,
      title: sql<string>`coalesce(${events.headline}, ${events.title})`,
      kind: deliveries.kind,
      editionKey: deliveries.digestDate,
      sentAt: firstSent,
      up,
      down,
    })
    .from(deliveries)
    .innerJoin(events, eq(events.id, deliveries.eventId))
    .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
    .where(where)
    .groupBy(events.id, deliveries.kind, deliveries.digestDate)
    .orderBy(desc(firstSent))
    .limit(limit)

export const readThread = async (db: Db, id: number) => {
  const [row] = await db
    .select({
      id: threads.id,
      name: threads.name,
      description: threads.description,
      status: threads.status,
      mergedInto: threads.mergedInto,
      firstSeen: threads.firstSeen,
    })
    .from(threads)
    .where(eq(threads.id, id))
  return row ?? null
}

/** Active threads, provisional ones too when asked, latest activity first, with their story. */
export const readThreads = (db: Db, o: { provisional: boolean; limit: number }) =>
  db
    .select({
      id: threads.id,
      name: threads.name,
      description: threads.description,
      status: threads.status,
      lastSeen: threads.lastSeen,
      momentum24h: threads.momentum24h,
      momentum7d: threads.momentum7d,
      storyName: stories.name,
    })
    .from(threads)
    .leftJoin(stories, eq(stories.id, threads.storyId))
    .where(inArray(threads.status, o.provisional ? ["active", "provisional"] : ["active"]))
    .orderBy(desc(threads.lastSeen))
    .limit(o.limit)

/** Unmerged stories, latest activity first, each with up to `perStory` names of its latest threads. */
export const readStories = async (db: Db, o: { limit: number; perStory: number }) => {
  const rows = await db
    .select({
      id: stories.id,
      name: stories.name,
      description: stories.description,
      status: stories.status,
      lastSeen: stories.lastSeen,
      threadCount: stories.threadCount,
    })
    .from(stories)
    .where(ne(stories.status, "merged"))
    .orderBy(desc(stories.lastSeen))
    .limit(o.limit)
  const names = await storyExamples(
    db,
    rows.map((r) => r.id),
    o.perStory,
  )
  return rows.map((r) => ({ ...r, threads: names.get(r.id) ?? [] }))
}

const HOUR = 3_600_000

/** Articles per hour in [from, to), both hour starts, zero-filled, by key. Keep keys under 95 (bound parameters). */
export const readSparks = async (db: Db, kind: RollupKind, keys: string[], from: number, to: number) => {
  const out = new Map(keys.map((k) => [k, Array<number>((to - from) / HOUR).fill(0)]))
  for (const r of await rollupBuckets(db, kind, keys, from, to)) {
    const values = out.get(r.key)
    if (values) values[(r.bucket - from) / HOUR] = r.articles
  }
  return out
}

/** The newest hour's movers in rank order, entity rows with the entity's key. */
export const readMovers = (db: Db, limit: number) =>
  db
    .select({
      kind: movers.kind,
      key: movers.key,
      name: movers.name,
      change24h: movers.change24h,
      change7d: movers.change7d,
      reason: movers.reason,
      entityKey: entities.key,
    })
    .from(movers)
    .leftJoin(entities, and(eq(movers.kind, "entity"), eq(entities.id, sql`cast(${movers.key} as integer)`)))
    .where(eq(movers.bucket, sql`(select max(${movers.bucket}) from ${movers})`))
    .orderBy(movers.rank)
    .limit(limit)

/** The digest items of the given editions as sent, one row per event whatever the chats, in send order. */
export const readEditionItems = (db: Db, keys: string[]) =>
  db
    .select({
      editionKey: sql<string>`${deliveries.digestDate}`,
      eventId: events.id,
      title: sql<string>`coalesce(${events.headline}, ${events.title})`,
    })
    .from(deliveries)
    .innerJoin(events, eq(events.id, deliveries.eventId))
    .where(and(inArray(deliveries.digestDate, keys), eq(deliveries.kind, "digest")))
    .groupBy(deliveries.digestDate, events.id)
    .orderBy(sql`min(${deliveries.id})`)

/** What the v2 edition would have sent for the given editions, by edition, mode and rank. */
export const readShadowItems = (db: Db, keys: string[]) =>
  db
    .select({
      editionKey: digestsShadow.editionKey,
      mode: digestsShadow.mode,
      eventId: digestsShadow.eventId,
      title: sql<string>`coalesce(${events.headline}, ${events.title})`,
    })
    .from(digestsShadow)
    .innerJoin(events, eq(events.id, digestsShadow.eventId))
    .where(inArray(digestsShadow.editionKey, keys))
    .orderBy(digestsShadow.editionKey, digestsShadow.mode, digestsShadow.rank)

/** One event with its facets, entities, threads, latest relevance and deliveries; null for an unknown id. */
export const readEvent = async (db: Db, id: number, deliveryLimit: number) => {
  const flag = (c: AnyColumn) => sql<number>`coalesce(max(${c}), 0)`
  const [[row], ents, linked, [scored], [flags], sent] = await Promise.all([
    db
      .select({
        id: events.id,
        title: sql<string>`coalesce(${events.headline}, ${events.title})`,
        gist: events.gist,
        status: events.status,
        firstSeen: events.firstSeen,
        lastArticleAt: events.lastArticleAt,
        countries: events.countriesJson,
        eventType: events.eventType,
        advisoryOnly: events.advisoryOnly,
      })
      .from(events)
      .where(eq(events.id, id)),
    db
      .select({ key: entities.key, name: entities.name, kind: entities.kind })
      .from(eventEntities)
      .innerJoin(entities, eq(entities.id, eventEntities.entityId))
      .where(eq(eventEntities.eventId, id))
      .orderBy(desc(eventEntities.mentions)),
    db
      .select({ id: threads.id, name: threads.name })
      .from(eventThreads)
      .innerJoin(threads, eq(threads.id, eventThreads.threadId))
      .where(and(eq(eventThreads.eventId, id), inArray(threads.status, SHOWN_THREADS)))
      .orderBy(desc(eventThreads.confidence)),
    db
      .select({ score: relevance.score, reason: relevance.reason, profileVersion: relevance.profileVersion })
      .from(relevance)
      .where(eq(relevance.eventId, id))
      .orderBy(desc(relevance.profileVersion))
      .limit(1),
    db
      .select({
        opinion: flag(articleFacets.opinion),
        roundup: flag(articleFacets.roundup),
        promotional: flag(articleFacets.promotional),
      })
      .from(eventArticles)
      .innerJoin(articleFacets, eq(articleFacets.articleId, eventArticles.articleId))
      .where(eq(eventArticles.eventId, id)),
    readDeliveries(db, eq(events.id, id), deliveryLimit),
  ])
  if (!row) return null
  return {
    ...row,
    entities: ents,
    threads: linked,
    relevance: scored ?? null,
    flags: { opinion: !!flags?.opinion, roundup: !!flags?.roundup, promotional: !!flags?.promotional },
    deliveries: sent,
  }
}
