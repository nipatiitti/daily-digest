import { sql } from "drizzle-orm"
import { integer } from "drizzle-orm/sqlite-core"

/** Unix ms, filled in by SQLite when the caller leaves it out. */
export const nowMs = () => integer().notNull().default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)

export const flag = () => integer({ mode: "boolean" }).notNull().default(false)

export const CATEGORIES = ["security", "tech", "world", "fi"] as const
export type Category = (typeof CATEGORIES)[number]
