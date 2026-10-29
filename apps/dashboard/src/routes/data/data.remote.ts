import { DASHBOARD } from "@digest/core"
import { browseTable, editCell, rowById, rowId, type TableMeta, tableCounts, tableMeta } from "@digest/db"
import { error, invalid } from "@sveltejs/kit"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { form, getRequestEvent, query } from "$app/server"
import { browseInput } from "./browse.ts"

const metaOf = (name: string) => tableMeta(name) ?? error(404, `No table ${name}`)

/** The registry entry without its Drizzle table, which stays on the server. */
const shape = ({ table: _table, ...meta }: TableMeta) => meta

/** A db helper's Error here is about the URL (an unknown column, a value of the wrong type), so it is a 400. */
const badRequest = async <T>(run: () => Promise<T>) => {
  try {
    return await run()
  } catch (e) {
    if (e instanceof Error) error(400, e.message)
    throw e
  }
}

export const tableIndex = query(() => tableCounts(db()))

/** One page of a table, filtered and sorted as the URL says. */
export const browse = query(browseInput, async ({ table, ...opts }) => {
  const meta = metaOf(table)
  const page = await badRequest(() => browseTable(db(), meta, { ...opts, limit: DASHBOARD.browsePageSize }))
  return { meta: shape(meta), next: page.next, rows: page.rows.map((r) => ({ id: rowId(meta, r), values: r })) }
})

const cell = z.object({ table: z.string(), id: z.string() })

export const tableRow = query(cell, async ({ table, id }) => {
  const meta = metaOf(table)
  const row = await badRequest(() => rowById(db(), meta, id))
  if (!row) error(404, `No ${table} row ${id}`)
  return { meta: shape(meta), row }
})

/** Writes one editable cell as the signed-in user; a helper's Error becomes a form issue, then the row refreshes. */
export const editForm = form(cell.extend({ column: z.string(), value: z.string() }), async (f) => {
  try {
    await editCell(db(), metaOf(f.table), f.id, f.column, f.value, getRequestEvent().locals.user)
  } catch (e) {
    if (e instanceof Error) invalid(e.message)
    throw e
  }
  await tableRow({ table: f.table, id: f.id }).refresh()
})
