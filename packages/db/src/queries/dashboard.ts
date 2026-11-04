import { and, count, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  deliveries,
  digests,
  digestsShadow,
  entities,
  events,
  feedback,
  type ProfileFollows,
  threads,
} from "../schema/index.ts"

const votes = (vote: "up" | "down") => sql<number>`coalesce(sum(${feedback.vote} = ${vote}), 0)`

/**
 * The v2 editions: those sent at or after the send time of the first edition that sent an event, none before there
 * is one. An empty edition from then on counts too.
 */
const v2Sent = (db: Db) =>
  and(
    eq(digests.status, "sent"),
    gte(
      digests.sentAt,
      db
        .select({ at: sql<number | null>`min(${digests.sentAt})` })
        .from(digests)
        .where(
          inArray(
            digests.digestDate,
            db.select({ key: deliveries.digestDate }).from(deliveries).where(isNotNull(deliveries.eventId)),
          ),
        ),
    ),
  )

/**
 * The v2 editions keyed in [from, to) (YYYY-MM-DD), newest first, empty ones included: each edition key
 * (editionKey) with its distinct events sent as digest items or updates and their votes over every chat, and the
 * items of each shadow mode written for it. Keys compare as text, so a date's afternoon edition sorts after its
 * morning one and before the next date. `limit` caps both reads.
 */
export const digestEditions = async (db: Db, from: string, to: string, limit = -1) => {
  const [live, shadow] = await db.batch([
    db
      .select({
        key: digests.digestDate,
        items: sql<number>`count(distinct ${deliveries.eventId})`,
        up: votes("up"),
        down: votes("down"),
      })
      .from(digests)
      .leftJoin(
        deliveries,
        and(eq(deliveries.digestDate, digests.digestDate), inArray(deliveries.kind, ["digest", "update"])),
      )
      .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
      .where(and(v2Sent(db), gte(digests.digestDate, from), lt(digests.digestDate, to)))
      .groupBy(digests.digestDate)
      .orderBy(desc(digests.digestDate))
      .limit(limit),
    db
      .select({ key: digestsShadow.editionKey, mode: digestsShadow.mode, items: count() })
      .from(digestsShadow)
      .where(and(gte(digestsShadow.editionKey, from), lt(digestsShadow.editionKey, to)))
      .groupBy(digestsShadow.editionKey, digestsShadow.mode)
      .orderBy(desc(digestsShadow.editionKey))
      .limit(limit),
  ])
  return live.map((r) => ({ ...r, shadow: shadow.filter((s) => s.key === r.key) }))
}

/**
 * Edition `key` (editionKey) and the alerts sent in [from, to), in send order, each event once per kind with its copy
 * and its votes over every chat, then what the v2 edition would have sent for the key, by mode and rank. `v2` is
 * false for a key that is not a v2 edition.
 */
export const digestDay = async (db: Db, key: string, from: number, to: number) => {
  const sentAt = sql<number>`min(${deliveries.sentAt})`
  const [edition, sent, shadow] = await db.batch([
    db
      .select({ key: digests.digestDate })
      .from(digests)
      .where(and(eq(digests.digestDate, key), v2Sent(db))),
    db
      .select({
        kind: deliveries.kind,
        sentAt,
        up: votes("up"),
        down: votes("down"),
        eventId: events.id,
        headline: sql<string>`coalesce(${events.headline}, ${events.title})`,
        summary: sql<string>`coalesce(${events.summary}, ${events.gist})`,
        why: events.whyForYou,
      })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .leftJoin(feedback, eq(feedback.deliveryId, deliveries.id))
      .where(
        or(
          eq(deliveries.digestDate, key),
          and(eq(deliveries.kind, "alert"), gte(deliveries.sentAt, from), lt(deliveries.sentAt, to)),
        ),
      )
      .groupBy(events.id, deliveries.kind)
      .orderBy(sentAt),
    db
      .select()
      .from(digestsShadow)
      .where(eq(digestsShadow.editionKey, key))
      .orderBy(digestsShadow.mode, digestsShadow.rank),
  ])
  return { v2: edition.length > 0, sent, shadow }
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
