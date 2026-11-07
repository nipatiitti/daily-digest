import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  deliveries,
  digests,
  editionItems,
  editionJudgments,
  entities,
  events,
  feedback,
  type ProfileFollows,
  stories,
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

const items = (mode: "send" | "replay") => sql<number>`(select count(*) from ${editionItems}
  where ${editionItems.editionKey} = ${digests.digestDate} and ${editionItems.mode} = ${mode})`
const held = sql<number>`(select count(*) from ${editionJudgments}
  where ${editionJudgments.editionKey} = ${digests.digestDate} and ${editionJudgments.mode} = 'send'
  and ${editionJudgments.outcome} != 'sent')`

/**
 * The v2 editions keyed in [from, to) (YYYY-MM-DD), newest first, empty ones included: each edition key
 * (editionKey) with its distinct events sent as digest items or updates and their votes over every chat, the
 * candidates it held back, and its replayed items. Keys compare as text, so a date's afternoon edition sorts after
 * its morning one and before the next date. `limit` caps the read.
 */
export const digestEditions = (db: Db, from: string, to: string, limit = -1) =>
  db
    .select({
      key: digests.digestDate,
      items: sql<number>`count(distinct ${deliveries.eventId})`,
      up: votes("up"),
      down: votes("down"),
      held,
      replayed: items("replay"),
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
    .limit(limit)

/**
 * Edition `key` (editionKey) and the alerts sent in [from, to), in send order, each event once per kind with its copy,
 * story, gate and its votes over every chat; then the edition's items and judgments in each mode, items by rank and
 * judgments by gate. `v2` is false for a key that is not a v2 edition.
 */
export const digestDay = async (db: Db, key: string, from: number, to: number) => {
  const sentAt = sql<number>`min(${deliveries.sentAt})`
  const [edition, sent, itemRows, judgments] = await db.batch([
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
        headline: sql<string>`coalesce(${editionItems.headline}, ${events.headline}, ${events.title})`,
        summary: sql<string>`coalesce(${editionItems.summary}, ${events.summary}, ${events.gist})`,
        storyName: stories.name,
        isUpdate: sql<number>`coalesce(max(${editionItems.isUpdate}), 0)`,
        gate: sql<number | null>`max(${editionItems.gate})`,
      })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .leftJoin(editionItems, eq(editionItems.id, deliveries.editionItemId))
      .leftJoin(stories, eq(stories.id, deliveries.storyId))
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
      .select({
        mode: editionItems.mode,
        rank: editionItems.rank,
        eventId: editionItems.leadEventId,
        text: editionItems.text,
        storyName: stories.name,
        gate: editionItems.gate,
        score: editionItems.score,
        asOf: editionItems.asOf,
      })
      .from(editionItems)
      .leftJoin(stories, eq(stories.id, editionItems.storyId))
      .where(eq(editionItems.editionKey, key))
      .orderBy(editionItems.mode, editionItems.rank),
    db
      .select({
        mode: editionJudgments.mode,
        eventId: editionJudgments.eventId,
        title: sql<string>`coalesce(${events.headline}, ${events.title})`,
        storyName: stories.name,
        significance: editionJudgments.significance,
        material: editionJudgments.material,
        act: editionJudgments.act,
        interest: editionJudgments.interest,
        gate: editionJudgments.gate,
        change: editionJudgments.change,
        outcome: editionJudgments.outcome,
        reason: editionJudgments.reason,
      })
      .from(editionJudgments)
      .innerJoin(events, eq(events.id, editionJudgments.eventId))
      .leftJoin(stories, eq(stories.id, editionJudgments.storyId))
      .where(eq(editionJudgments.editionKey, key))
      .orderBy(editionJudgments.mode, sql`${editionJudgments.gate} desc nulls last`, editionJudgments.eventId),
  ])
  return { v2: edition.length > 0, sent, items: itemRows, judgments }
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
