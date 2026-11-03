import { eq } from "drizzle-orm"
import type { Db } from "../client.ts"
import { entities, hourlyRuns } from "../schema/index.ts"

export const entityByKey = async (db: Db, key: string) => {
  const [row] = await db.select().from(entities).where(eq(entities.key, key))
  return row ?? null
}

export const entityById = async (db: Db, id: number) => {
  const [row] = await db.select().from(entities).where(eq(entities.id, id))
  return row ?? null
}

export const lastRun = async (db: Db, step: string) => {
  const [row] = await db.select().from(hourlyRuns).where(eq(hourlyRuns.step, step))
  return row ?? null
}

export const markRun = (db: Db, step: string, at: number, detail: Record<string, number>) =>
  db
    .insert(hourlyRuns)
    .values({ step, lastRunAt: at, detailJson: detail })
    .onConflictDoUpdate({ target: hourlyRuns.step, set: { lastRunAt: at, detailJson: detail } })
