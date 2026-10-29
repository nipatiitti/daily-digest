import type { BrowseFilter } from "@digest/db"
import { z } from "zod"

const OPS: readonly string[] = ["eq", "contains", "gte", "lte"] satisfies BrowseFilter["op"][]
const isOp = (op: string | undefined): op is BrowseFilter["op"] => op !== undefined && OPS.includes(op)

/**
 * The table browser's state from a URL query string: `q` is the full-text search, `sort` and `dir` the order, `after`
 * the row ID the page starts after, and each `<column>.<op>` key with a value a filter. The browse query and the CSV
 * export both parse it here, so a download matches the page.
 */
export const browseInput = z.object({ table: z.string(), search: z.string() }).transform(({ table, search }) => {
  const p = new URLSearchParams(search)
  const filters = [...p].flatMap(([key, value]) => {
    const [column = "", op] = key.split(".")
    return isOp(op) && value.trim() ? [{ column, op, value: value.trim() }] : []
  })
  const dir: "asc" | "desc" = p.get("dir") === "asc" ? "asc" : "desc"
  return {
    table,
    filters,
    sort: { column: p.get("sort") || undefined, dir },
    after: p.get("after") || undefined,
    q: p.get("q")?.trim() || undefined,
  }
})
