import { DASHBOARD } from "@digest/core"
import { exportRows, tableMeta } from "@digest/db"
import { error } from "@sveltejs/kit"
import { db } from "#lib/server/db.ts"
import { browseInput } from "../../browse.ts"
import type { RequestHandler } from "./$types"

/**
 * RFC 4180: a field with a comma, quote or line break is quoted, its quotes doubled. Text a spreadsheet would read
 * as a formula gets a leading quote; numbers are left as they are. A vector is left empty.
 */
const field = (v: unknown) => {
  const raw =
    v === null || v === undefined || ArrayBuffer.isView(v) ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
  const s = typeof v !== "number" && /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
const line = (values: unknown[]) => `${values.map(field).join(",")}\r\n`

/** The browser's current view as CSV, capped at DASHBOARD.exportMaxRows and streamed a chunk at a time. */
export const GET: RequestHandler = async ({ params, url }) => {
  const meta = tableMeta(params.table) ?? error(404, `No table ${params.table}`)
  const query = browseInput.parse({ table: meta.name, search: url.search })
  const names = meta.columns.map((c) => c.name)
  const csv = (rows: Record<string, unknown>[]) => rows.map((r) => line(names.map((n) => r[n]))).join("")
  const chunks = exportRows(db(), meta, query, DASHBOARD.exportMaxRows)
  // The first chunk is read before the response starts, so an unknown column or bad value is still a 400.
  let first: IteratorResult<Record<string, unknown>[]>
  try {
    first = await chunks.next()
  } catch (e) {
    if (e instanceof Error) error(400, e.message)
    throw e
  }
  const body = new ReadableStream<string>({
    start(c) {
      c.enqueue(line(names))
      if (!first.done) c.enqueue(csv(first.value))
    },
    async pull(c) {
      const next = await chunks.next()
      if (next.done) c.close()
      else c.enqueue(csv(next.value))
    },
  })
  return new Response(body.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${meta.name}.csv"`,
    },
  })
}
