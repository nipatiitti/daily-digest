import { and, count, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  deliveries,
  digestsShadow,
  entities,
  events,
  feedback,
  type ProfileFollows,
  stories,
  threads,
} from "../schema/index.ts"

const votes = (vote: "up" | "down") => sql<number>`coalesce(sum(${feedback.vote} = ${vote}), 0)`

/**
 * Digest editions keyed in [from, to) (YYYY-MM-DD), newest first: each edition key (editionKey) with digest or update
 * deliveries, its distinct stories or events and its votes over every chat, and the items of each shadow mode written
 * for it, so keys with only shadow or replay rows are listed too. Keys compare as text, so a date's afternoon edition
 * sorts after its morning one and before the next date. `limit` caps both reads.
 */
export const digestEditions = async (db: Db, from: string, to: string, limit = -1) => {
  const [live, shadow] = await db.batch([
    db
      .select({
        key: sql<string>`${deliveries.digestDate}`,
        items: sql<number>`count(distinct coalesce('s' || ${deliveries.storyId}, 'e' || ${deliveries.eventId}))`,
        up: votes("up"),
        down: votes("down"),
      })
      .from(deliveries)
      .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
      .where(
        and(
          inArray(deliveries.kind, ["digest", "update"]),
          gte(deliveries.digestDate, from),
          lt(deliveries.digestDate, to),
        ),
      )
      .groupBy(deliveries.digestDate)
      .orderBy(desc(deliveries.digestDate))
      .limit(limit),
    db
      .select({ key: digestsShadow.editionKey, mode: digestsShadow.mode, items: count() })
      .from(digestsShadow)
      .where(and(gte(digestsShadow.editionKey, from), lt(digestsShadow.editionKey, to)))
      .groupBy(digestsShadow.editionKey, digestsShadow.mode)
      .orderBy(desc(digestsShadow.editionKey))
      .limit(limit),
  ])
  const keys = [...new Set([...live, ...shadow].map((r) => r.key))].toSorted().toReversed()
  return keys.map((key) => ({
    key,
    live: live.find((r) => r.key === key) ?? null,
    shadow: shadow.filter((r) => r.key === key),
  }))
}

/**
 * Edition `key` (editionKey) and the alerts sent in [from, to), in send order, each story or event once per kind with
 * its votes over every chat: v1 rows carry the stored fields a digest item is rendered from, v2 rows the event's copy.
 * Then what the v2 edition would have sent for the key, by mode and rank.
 */
export const digestDay = async (db: Db, key: string, from: number, to: number) => {
  const sentAt = sql<number>`min(${deliveries.sentAt})`
  const sent = or(
    eq(deliveries.digestDate, key),
    and(eq(deliveries.kind, "alert"), gte(deliveries.sentAt, from), lt(deliveries.sentAt, to)),
  )
  const base = { kind: deliveries.kind, sentAt, up: votes("up"), down: votes("down") }
  const [v1, v2, shadow] = await db.batch([
    db
      .select({
        ...base,
        storyId: stories.id,
        scoreAtSend: sql<number | null>`max(${deliveries.scoreAtSend})`,
        category: stories.category,
        fiRelevance: stories.fiRelevance,
        title: stories.title,
        summary: stories.summary,
        independentOrigins: stories.independentOrigins,
      })
      .from(deliveries)
      .innerJoin(stories, eq(stories.id, deliveries.storyId))
      .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
      .where(sent)
      .groupBy(stories.id, deliveries.kind)
      .orderBy(sentAt),
    db
      .select({
        ...base,
        eventId: events.id,
        headline: sql<string>`coalesce(${events.headline}, ${events.title})`,
        summary: sql<string>`coalesce(${events.summary}, ${events.gist})`,
        why: events.whyForYou,
      })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
      .where(sent)
      .groupBy(events.id, deliveries.kind)
      .orderBy(sentAt),
    db
      .select()
      .from(digestsShadow)
      .where(eq(digestsShadow.editionKey, key))
      .orderBy(digestsShadow.mode, digestsShadow.rank),
  ])
  return { v1, v2, shadow }
}

/** The followed threads and entities that exist, with their names. */
export const followedNames = async (db: Db, f: ProfileFollows) => {
  const [t, e] = await db.batch([
    db.select({ id: threads.id, name: threads.name }).from(threads).where(inArray(threads.id, f.threads)),
    db
      .select({ key: entities.key, name: entities.name, kind: entities.kind })
      .from(entities)
      .where(inArray(entities.key, f.entities)),
  ])
  return { threads: t, entities: e }
}
