import { BRIEF, HOUR_MS, hourBucket } from "@digest/core"
import { briefsBetween } from "@digest/db"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

/** One page of BRIEF.historyHours of briefs, newest first, page 1 ending with the current hour. */
export const briefPage = query(z.number().int().positive(), async (page) => {
  const d = db()
  const span = BRIEF.historyHours * HOUR_MS
  const to = hourBucket(Date.now()) + HOUR_MS - (page - 1) * span
  const [rows, older] = await Promise.all([briefsBetween(d, to - span, to), briefsBetween(d, 0, to - span, 1)])
  return { rows: rows.map(({ id, at, text }) => ({ id, at, text })), more: older.length > 0 }
})
