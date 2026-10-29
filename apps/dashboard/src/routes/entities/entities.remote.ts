import { bucketsBetween, DASHBOARD, HOUR_MS, hourBucket } from "@digest/core"
import { entityList, rollupBuckets } from "@digest/db"
import { z } from "zod"
import { byKeyBucket } from "#lib/components/format.ts"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

const search = z.string().trim().max(200)

/** Entities by story count, optionally matching a name search, each with articles per hour over the last day. */
export const entityRows = query(search, async (q) => {
  const d = db()
  const rows = await entityList(d, { q, limit: DASHBOARD.storiesPageSize })
  const to = hourBucket(Date.now())
  const from = to - DASHBOARD.readoutSparkPoints * HOUR_MS
  const spark = await rollupBuckets(
    d,
    "entity",
    rows.map((r) => String(r.id)),
    from,
    to,
  )
  const count = byKeyBucket(spark)
  const hours = bucketsBetween(from, to)
  return rows.map((r) => ({ ...r, spark: hours.map((b) => count(r.id, b)) }))
})
