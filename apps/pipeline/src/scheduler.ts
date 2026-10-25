import { FETCH } from "@digest/core"
import { claimDueSources, type Db } from "@digest/db"
import type { FetchMessage } from "./fetch.ts"

/** Minute cron: claim due sources and hand them to fetch-q. Kept thin for the cron CPU limit. */
export const scheduleDueSources = async (db: Db, queue: Queue<FetchMessage>, now: number) => {
  const claimed = await claimDueSources(db, now, FETCH.maxSourcesPerTick)
  if (claimed.length === 0) return
  await queue.sendBatch(claimed.map(({ id }) => ({ body: { sourceId: id } })))
}
