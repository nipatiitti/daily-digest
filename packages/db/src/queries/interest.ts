import { and, eq, getTableColumns, gte, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch, selectIn } from "../client.ts"
import { events, interest } from "../schema/index.ts"

/**
 * Unmerged, substantial events with no interest row for this profile version, or whose independent origins reached
 * `factor` times those when scored: active ones with an article since `since`, or the given ones.
 */
export const interestTargets = (
  db: Db,
  o: { version: number; factor: number; minOrigins: number; minOfficial: number } & (
    | { since: number }
    | { eventIds: number[] }
  ),
) => {
  const due = (which: SQL | undefined) =>
    db
      .select({
        id: events.id,
        title: events.title,
        gist: events.gist,
        countries: events.countriesJson,
        eventType: events.eventType,
        independentOrigins: events.independentOrigins,
        lastArticleAt: events.lastArticleAt,
      })
      .from(events)
      .leftJoin(interest, and(eq(interest.eventId, events.id), eq(interest.profileVersion, o.version)))
      .where(
        and(
          which,
          ne(events.status, "merged"),
          or(gte(events.independentOrigins, o.minOrigins), gte(events.officialCount, o.minOfficial)),
          or(isNull(interest.eventId), gte(events.independentOrigins, sql`${o.factor} * ${interest.originsAtScore}`)),
        ),
      )
  if ("eventIds" in o) return selectIn(db, o.eventIds, 2, (chunk) => due(inArray(events.id, chunk)))
  return due(and(eq(events.status, "active"), gte(events.lastArticleAt, o.since)))
}

export type InterestTarget = Awaited<ReturnType<typeof interestTargets>>[number]

export const saveInterest = (db: Db, rows: (typeof interest.$inferInsert)[]) =>
  runBatch(
    db,
    chunkRows(rows, Object.keys(getTableColumns(interest)).length).map((chunk) =>
      db
        .insert(interest)
        .values(chunk)
        .onConflictDoUpdate({
          target: [interest.eventId, interest.profileVersion],
          set: {
            level: sql`excluded.level`,
            muted: sql`excluded.muted`,
            reason: sql`excluded.reason`,
            originsAtScore: sql`excluded.origins_at_score`,
            llmCallId: sql`excluded.llm_call_id`,
            at: sql`excluded.at`,
          },
        }),
    ),
  )

/** The events' interest rows for this profile version, by event id. */
export const interestFor = async (db: Db, ids: number[], version: number) =>
  new Map(
    (
      await selectIn(db, ids, 2, (chunk) =>
        db
          .select({ eventId: interest.eventId, level: interest.level, muted: interest.muted, reason: interest.reason })
          .from(interest)
          .where(and(eq(interest.profileVersion, version), inArray(interest.eventId, chunk))),
      )
    ).map((r) => [r.eventId, r]),
  )

/** Each event's interest row from the highest profile version that scored it. */
export const latestInterest = async (db: Db, ids: number[]) => {
  const rows = await selectIn(db, ids, 1, (chunk) =>
    db
      .select({
        eventId: interest.eventId,
        profileVersion: interest.profileVersion,
        level: interest.level,
        muted: interest.muted,
        reason: interest.reason,
      })
      .from(interest)
      .where(inArray(interest.eventId, chunk))
      .orderBy(interest.profileVersion),
  )
  return new Map(rows.map((r) => [r.eventId, r]))
}
