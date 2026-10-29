import { env } from "cloudflare:workers"
import { getDb } from "@digest/db"

/** Drizzle over the shared D1 database. Server code only. */
export const db = () => getDb(env.DB)
