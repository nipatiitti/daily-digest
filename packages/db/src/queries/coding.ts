import { and, desc, eq, getTableColumns, gt, gte, inArray, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm"
import { chunkRows, type Db, runBatch, selectIn } from "../client.ts"
import { entities, eventActors, eventCodes, events } from "../schema/index.ts"

/**
 * Unmerged, substantial events whose code is due: none yet, independent origins at `factor` times those when coded,
 * or more origins than then and coded before `recodeBefore`. Either those with an article since `since`, latest
 * first, at most `limit`, or the given ones.
 */
export const codingTargets = (
  db: Db,
  o: { minOrigins: number; minOfficial: number; factor: number; recodeBefore: number } & (
    | { since: number; limit: number }
    | { eventIds: number[] }
  ),
) => {
  const due = (which: SQL | undefined) =>
    db
      .select({
        id: events.id,
        countries: events.countriesJson,
        eventType: events.eventType,
        independentOrigins: events.independentOrigins,
        lastArticleAt: events.lastArticleAt,
      })
      .from(events)
      .leftJoin(eventCodes, eq(eventCodes.eventId, events.id))
      .where(
        and(
          which,
          ne(events.status, "merged"),
          or(gte(events.independentOrigins, o.minOrigins), gte(events.officialCount, o.minOfficial)),
          or(
            isNull(eventCodes.eventId),
            gte(events.independentOrigins, sql`${o.factor} * ${eventCodes.originsAtCode}`),
            and(gt(events.independentOrigins, eventCodes.originsAtCode), lt(eventCodes.codedAt, o.recodeBefore)),
          ),
        ),
      )
  if ("eventIds" in o) return selectIn(db, o.eventIds, 1, (chunk) => due(inArray(events.id, chunk)))
  return due(gte(events.lastArticleAt, o.since)).orderBy(desc(events.lastArticleAt), desc(events.id)).limit(o.limit)
}

export type CodingTarget = Awaited<ReturnType<typeof codingTargets>>[number]

export type CodeRow = typeof eventCodes.$inferInsert & {
  eventId: number
  actors: { actor: string; role: "actor" | "target" }[]
}

/** Replace the events' codes and actors. */
export const saveCodes = (db: Db, rows: CodeRow[]) => {
  const ids = rows.map((r) => r.eventId)
  const codes = rows.map(({ actors: _, ...c }) => c)
  const actors = rows.flatMap((r) => r.actors.map((a) => ({ eventId: r.eventId, ...a })))
  return runBatch(db, [
    ...chunkRows(ids, 1).map((chunk) => db.delete(eventActors).where(inArray(eventActors.eventId, chunk))),
    ...chunkRows(codes, Object.keys(getTableColumns(eventCodes)).length).map((chunk) =>
      db
        .insert(eventCodes)
        .values(chunk)
        .onConflictDoUpdate({
          target: eventCodes.eventId,
          set: {
            material: sql`excluded.material`,
            significance: sql`excluded.significance`,
            act: sql`excluded.act`,
            valence: sql`excluded.valence`,
            stance: sql`excluded.stance`,
            reason: sql`excluded.reason`,
            originsAtCode: sql`excluded.origins_at_code`,
            codedAt: sql`excluded.coded_at`,
            llmCallId: sql`excluded.llm_call_id`,
          },
        }),
    ),
    ...chunkRows(actors, 3).map((chunk) => db.insert(eventActors).values(chunk).onConflictDoNothing()),
  ])
}

/** The events' codes, by event id. */
export const codesFor = async (db: Db, ids: number[]) =>
  new Map(
    (await selectIn(db, ids, 1, (chunk) => db.select().from(eventCodes).where(inArray(eventCodes.eventId, chunk)))).map(
      (r) => [r.eventId, r],
    ),
  )

/** One event's code with its actors named: an entity's name, or the country code for the caller to name. */
export const readEventCode = async (db: Db, id: number) => {
  const [[code], actors] = await Promise.all([
    db.select().from(eventCodes).where(eq(eventCodes.eventId, id)),
    db
      .select({ actor: eventActors.actor, role: eventActors.role, name: entities.name })
      .from(eventActors)
      .leftJoin(entities, eq(entities.key, eventActors.actor))
      .where(eq(eventActors.eventId, id)),
  ])
  return code ? { ...code, actors } : null
}
