import { HOME, HOUR_MS, hourBucket } from "@digest/core"
import { readSparks, readStories, readThreads } from "@digest/db"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

/** Active threads, provisional ones too when asked, latest activity first, each with articles per hour. */
export const threadRows = query(z.boolean(), async (provisional) => {
  const d = db()
  const rows = await readThreads(d, { provisional, limit: HOME.threadList })
  const to = hourBucket(Date.now())
  const sparks = await readSparks(
    d,
    "thread",
    rows.map((r) => String(r.id)),
    to - HOME.sparkHours * HOUR_MS,
    to,
  )
  return rows.map((r) => ({ ...r, spark: sparks.get(String(r.id)) ?? [] }))
})

/** Stories, latest activity first, with the names of their latest threads. */
export const storyRows = query(async () => readStories(db(), { limit: HOME.storyList, perStory: HOME.storyThreads }))
