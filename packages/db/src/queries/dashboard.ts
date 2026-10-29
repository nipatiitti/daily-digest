import { and, isNotNull, isNull, sql } from "drizzle-orm"
import type { Db } from "../client.ts"
import { sources, stories } from "../schema/index.ts"
import { spendSince } from "./ops.ts"

/** The three header lamps: newest fetched item, stories waiting for a score, Claude spend since UTC midnight. */
export const lampInputs = async (db: Db, now: number) => {
  const [[newest], [backlog], spendTodayUsd] = await Promise.all([
    db.select({ at: sql<number | null>`max(${sources.lastNewItemAt})` }).from(sources),
    db
      .select({ n: sql<number>`count(*)` })
      .from(stories)
      .where(and(isNotNull(stories.extractionHash), isNull(stories.score))),
    spendSince(db, now - (now % 86_400_000)),
  ])
  return {
    minutesSinceNewItem: newest?.at == null ? null : Math.floor((now - newest.at) / 60_000),
    evalBacklog: backlog?.n ?? 0,
    spendTodayUsd,
  }
}
