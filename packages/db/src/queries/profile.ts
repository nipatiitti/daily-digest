import { and, desc, eq, gt, gte, inArray, isNotNull, lte, notInArray, type SQL, sql } from "drizzle-orm"
import { type Db, selectIn } from "../client.ts"
import {
  articles,
  deliveries,
  entities,
  eventArticles,
  eventEntities,
  events,
  eventThreads,
  feedback,
  type Profile,
  type ProfileEdit,
  type ProfileFollows,
  type ProfileVersion,
  profileProposals,
  profileVersions,
  sources,
  stories,
  threads,
} from "../schema/index.ts"

const toProfile = (r: ProfileVersion): Profile => ({
  text: r.text,
  topics: r.topicsJson,
  follows: r.followsJson,
  regions: r.regionsJson,
  mutes: r.mutesJson,
})

/** The highest version, or null before the seed has run. */
export const currentProfile = async (db: Db) => {
  const [row] = await db.select().from(profileVersions).orderBy(desc(profileVersions.version)).limit(1)
  return row ? { version: row.version, profile: toProfile(row), createdAt: row.createdAt } : null
}

export const profileHistory = (db: Db, limit: number) =>
  db.select().from(profileVersions).orderBy(desc(profileVersions.version)).limit(limit)

/** Appends a version one above the highest, in one statement; returns its number. */
export const saveProfile = async (
  db: Db,
  profile: Profile,
  o: { by: string; note: string | null; proposalId?: number },
) => {
  const [row] = await db
    .insert(profileVersions)
    .values({
      version: sql`(select coalesce(max(version), 0) + 1 from profile_versions)`,
      text: profile.text,
      topicsJson: profile.topics,
      followsJson: profile.follows,
      regionsJson: profile.regions,
      mutesJson: profile.mutes,
      note: o.note,
      proposalId: o.proposalId,
      by: o.by,
    })
    .returning({ version: profileVersions.version })
  if (!row) throw new Error("profile insert returned no row")
  return row.version
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const withValue = (list: string[], v: string) => (list.some((x) => same(x, v)) ? list : [...list, v.trim()])
const without = (list: string[], v: string) => list.filter((x) => !same(x, v))

const applyEdit = (p: Profile, e: ProfileEdit): Profile => {
  switch (e.op) {
    case "set_topic": {
      const weight = Math.min(3, Math.max(1, Math.round(e.weight)))
      const known = p.topics.some((t) => same(t.name, e.name))
      const topics = p.topics.map((t) => (same(t.name, e.name) ? { ...t, weight } : t))
      return { ...p, topics: known ? topics : [...topics, { name: e.name.trim(), weight }] }
    }
    case "remove_topic":
      return { ...p, topics: p.topics.filter((t) => !same(t.name, e.name)) }
    case "add_mute":
      return { ...p, mutes: withValue(p.mutes, e.value) }
    case "remove_mute":
      return { ...p, mutes: without(p.mutes, e.value) }
    case "add_region":
      return { ...p, regions: withValue(p.regions, e.value.toUpperCase()) }
    case "remove_region":
      return { ...p, regions: without(p.regions, e.value) }
    case "append_text": {
      const value = e.value.trim()
      if (p.text.toLowerCase().includes(value.toLowerCase())) return p
      return { ...p, text: p.text.trim() ? `${p.text.trimEnd()}\n\n${value}` : value }
    }
  }
}

/** Applies each edit case-insensitively; applying the same edits twice changes nothing more. Pure. */
export const applyEdits = (profile: Profile, edits: ProfileEdit[]) => edits.reduce(applyEdit, profile)

export const pendingProposals = (db: Db) =>
  db
    .select()
    .from(profileProposals)
    .where(eq(profileProposals.status, "pending"))
    .orderBy(desc(profileProposals.createdAt))

export const insertProposal = async (
  db: Db,
  p: Omit<typeof profileProposals.$inferInsert, "id" | "status" | "createdAt">,
) => {
  const [row] = await db.insert(profileProposals).values(p).returning({ id: profileProposals.id })
  if (!row) throw new Error("proposal insert returned no row")
  return row.id
}

/**
 * Decides a pending proposal; the update is the claim, so a second tap does nothing. Accepting applies its edits to
 * the current profile, not the version it was based on, and returns the new version; otherwise null.
 */
export const decideProposal = async (db: Db, id: number, accept: boolean, by: string) => {
  const [p] = await db
    .update(profileProposals)
    .set({ status: accept ? "accepted" : "rejected", decidedAt: Date.now(), decidedBy: by })
    .where(and(eq(profileProposals.id, id), eq(profileProposals.status, "pending")))
    .returning()
  const current = p && accept ? await currentProfile(db) : null
  if (!p || !current) return null
  return saveProfile(db, applyEdits(current.profile, p.editsJson), { by, note: `Proposal ${id}`, proposalId: id })
}

const balance = sql<number>`sum(case when ${feedback.vote} = 'up' then 1 else -1 end)`

/**
 * Up minus down votes cast since `since`, and up to `until` when given, on v2 deliveries, per thread and per entity
 * of the delivered event. Places and topics carry no balance: a vote on one story says nothing about a country.
 */
export const voteBalances = async (db: Db, since: number, until?: number) => {
  const voted = and(
    gte(feedback.createdAt, since),
    until === undefined ? undefined : lte(feedback.createdAt, until),
    isNotNull(deliveries.eventId),
  )
  const [byThread, byEntity] = await Promise.all([
    db
      .select({ id: deliveries.threadId, balance })
      .from(feedback)
      .innerJoin(deliveries, eq(deliveries.id, feedback.deliveryId))
      .where(and(voted, isNotNull(deliveries.threadId)))
      .groupBy(deliveries.threadId),
    db
      .select({ id: eventEntities.entityId, balance })
      .from(feedback)
      .innerJoin(deliveries, eq(deliveries.id, feedback.deliveryId))
      .innerJoin(eventEntities, eq(eventEntities.eventId, deliveries.eventId))
      .innerJoin(entities, eq(entities.id, eventEntities.entityId))
      .where(and(voted, notInArray(entities.kind, ["place", "topic"])))
      .groupBy(eventEntities.entityId),
  ])
  return {
    threads: new Map(byThread.flatMap((r) => (r.id === null ? [] : [[r.id, r.balance] as const]))),
    entities: new Map(byEntity.map((r) => [r.id, r.balance] as const)),
  }
}

const toggle = <T>(list: T[], v: T, on: boolean) =>
  on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v)

/**
 * Follows or unfollows a thread (its ID), an entity (its key) or a country (ISO code); returns the new version.
 * Throws when the follows of all kinds together would exceed `maxFollows` (PROFILE.maxFollows).
 */
export const setFollow = async (
  db: Db,
  kind: "thread" | "entity" | "country",
  key: string,
  on: boolean,
  by: string,
  maxFollows: number,
) => {
  const current = await currentProfile(db)
  if (!current) throw new Error("no profile yet")
  const f = current.profile.follows
  const id = Number(key)
  if (kind === "thread" && !Number.isInteger(id)) throw new Error(`not a thread id: ${key}`)
  const follows: ProfileFollows =
    kind === "thread"
      ? { ...f, threads: toggle(f.threads, id, on) }
      : kind === "entity"
        ? { ...f, entities: toggle(f.entities, key, on) }
        : { ...f, countries: toggle(f.countries, key.toUpperCase(), on) }
  if (follows.threads.length + follows.entities.length + follows.countries.length > maxFollows) {
    throw new Error(`At most ${maxFollows} follows. Unfollow something first.`)
  }
  const note = `${on ? "Follow" : "Unfollow"} ${kind} ${kind === "country" ? key.toUpperCase() : key}`
  return saveProfile(db, { ...current.profile, follows }, { by, note })
}

const roles = (from: SQL) => sql<string | null>`(select group_concat(distinct ${sources.role}) ${from})`

/**
 * Votes cast after `since` and up to `until`, oldest first, with what was delivered: the event's copy, thread,
 * countries and member source roles for v2 deliveries, the story and its articles' source roles for v1 ones.
 */
export const reactionVotes = async (db: Db, since: number, until: number) => {
  const rows = await db
    .select({
      feedbackId: feedback.id,
      vote: feedback.vote,
      eventId: deliveries.eventId,
      eventHeadline: sql<string | null>`coalesce(${events.headline}, ${events.title})`,
      eventSummary: sql<string | null>`coalesce(${events.summary}, ${events.gist})`,
      countries: events.countriesJson,
      threadName: threads.name,
      storyTitle: stories.title,
      storySummary: stories.summary,
      eventRoles: roles(sql`from ${eventArticles} join ${articles} on ${articles.id} = ${eventArticles.articleId}
        join ${sources} on ${sources.id} = ${articles.sourceId} where ${eventArticles.eventId} = ${deliveries.eventId}`),
      storyRoles: roles(sql`from ${articles} join ${sources} on ${sources.id} = ${articles.sourceId}
        where ${articles.storyId} = ${deliveries.storyId}`),
    })
    .from(feedback)
    .innerJoin(deliveries, eq(deliveries.id, feedback.deliveryId))
    .leftJoin(events, eq(events.id, deliveries.eventId))
    .leftJoin(threads, eq(threads.id, deliveries.threadId))
    .leftJoin(stories, eq(stories.id, deliveries.storyId))
    .where(and(gt(feedback.createdAt, since), lte(feedback.createdAt, until)))
    .orderBy(feedback.id)
  return rows.flatMap((r) => {
    const v2 = r.eventId !== null
    const headline = v2 ? r.eventHeadline : r.storyTitle
    if (!headline) return []
    return [
      {
        feedbackId: r.feedbackId,
        vote: r.vote,
        headline,
        summary: v2 ? r.eventSummary : r.storySummary,
        threadName: v2 ? r.threadName : null,
        countries: v2 ? (r.countries ?? []) : [],
        sourceRoles: ((v2 ? r.eventRoles : r.storyRoles) ?? "").split(",").filter(Boolean),
      },
    ]
  })
}

/**
 * Links from events to followed threads and entities, threads first: active events with an article since `since`,
 * or the given events whatever their state. Up to PROFILE.maxFollows (60) follows leave room for 33 ids a query.
 */
export const followedLinks = async (db: Db, follows: ProfileFollows, o: { since: number } | { eventIds: number[] }) => {
  const byThread = (which: SQL | undefined) =>
    db
      .select({ eventId: events.id, lastArticleAt: events.lastArticleAt, id: threads.id, name: threads.name })
      .from(eventThreads)
      .innerJoin(events, eq(events.id, eventThreads.eventId))
      .innerJoin(threads, eq(threads.id, eventThreads.threadId))
      .where(and(which, inArray(eventThreads.threadId, follows.threads)))
  const byEntity = (which: SQL | undefined) =>
    db
      .select({ eventId: events.id, lastArticleAt: events.lastArticleAt, id: entities.id, name: entities.name })
      .from(eventEntities)
      .innerJoin(events, eq(events.id, eventEntities.eventId))
      .innerJoin(entities, eq(entities.id, eventEntities.entityId))
      .where(and(which, inArray(entities.key, follows.entities)))
  const recent = "since" in o ? and(eq(events.status, "active"), gte(events.lastArticleAt, o.since)) : undefined
  const given = "since" in o ? [] : o.eventIds
  const [threadRows, entityRows] = await Promise.all([
    recent ? byThread(recent) : selectIn(db, given, 3, (chunk) => byThread(inArray(events.id, chunk))),
    recent ? byEntity(recent) : selectIn(db, given, 3, (chunk) => byEntity(inArray(events.id, chunk))),
  ])
  return [
    ...threadRows.map((r) => ({ ...r, kind: "thread" as const })),
    ...entityRows.map((r) => ({ ...r, kind: "entity" as const })),
  ]
}

/** Alert deliveries sent since `since`, plus any ever sent for the given events; a delivery may come twice. */
export const alertDeliveries = async (db: Db, since: number, eventIds: number[]) => {
  const alerts = (which: SQL) =>
    db
      .select({ eventId: deliveries.eventId, sentAt: deliveries.sentAt })
      .from(deliveries)
      .where(and(eq(deliveries.kind, "alert"), isNotNull(deliveries.eventId), which))
  const [recent, given] = await Promise.all([
    alerts(gte(deliveries.sentAt, since)),
    selectIn(db, eventIds, 2, (chunk) => alerts(inArray(deliveries.eventId, chunk))),
  ])
  return [...recent, ...given]
}
