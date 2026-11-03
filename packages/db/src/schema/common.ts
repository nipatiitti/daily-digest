import { sql } from "drizzle-orm"
import { customType, integer } from "drizzle-orm/sqlite-core"

/** Unix ms, filled in by SQLite when the caller leaves it out. */
export const nowMs = () => integer().notNull().default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)

export const flag = () => integer({ mode: "boolean" }).notNull().default(false)

export const CATEGORIES = ["security", "tech", "world", "fi"] as const
export type Category = (typeof CATEGORIES)[number]

/**
 * A float32 vector as a BLOB. Custom rather than `blob({ mode: "buffer" })`: Buffer has no type in the Workers apps,
 * and D1 may hand back an ArrayBuffer, a view or a number array, so every read is copied into an aligned buffer.
 */
export const vector = customType<{ data: Float32Array; driverData: ArrayBuffer | ArrayBufferView | number[] }>({
  dataType: () => "blob",
  toDriver: (v) => new Float32Array(v).buffer,
  fromDriver: (v) => {
    const bytes =
      v instanceof ArrayBuffer
        ? new Uint8Array(v)
        : ArrayBuffer.isView(v)
          ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
          : Uint8Array.from(v)
    return new Float32Array(bytes.slice().buffer)
  },
})
