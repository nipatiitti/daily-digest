import type { BatchItem } from "drizzle-orm/batch"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema/index.ts"

export type D1 = Parameters<typeof drizzle>[0]

export const getDb = (d1: D1) => drizzle(d1, { schema, casing: "snake_case" })

export type Db = ReturnType<typeof getDb>

/** D1 rejects statements with more than 100 bound parameters. */
export const MAX_PARAMS = 100

/** Split rows so each multi-row insert stays under the bound-parameter limit. */
export const chunkRows = <T>(rows: T[], paramsPerRow: number): T[][] => {
  const size = Math.max(1, Math.floor(MAX_PARAMS / paramsPerRow))
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size))
  }
  return chunks
}

/** Run statements in one D1 batch (a single implicit transaction). */
export const runBatch = async (db: Db, queries: BatchItem<"sqlite">[]) => {
  const [first, ...rest] = queries
  if (!first) return []
  return db.batch([first, ...rest])
}
