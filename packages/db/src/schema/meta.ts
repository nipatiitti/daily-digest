import { and, type Column, eq, getTableColumns, getTableName, is } from "drizzle-orm"
import { toSnakeCase } from "drizzle-orm/casing"
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core"
// The files, not index.ts: index.ts re-exports this module, so reading its tables here would hit the cycle.
import * as articles from "./articles.ts"
import * as delivery from "./delivery.ts"
import * as ops from "./ops.ts"
import * as rollups from "./rollups.ts"
import * as sources from "./sources.ts"
import * as stories from "./stories.ts"

type Schema = typeof articles & typeof delivery & typeof ops & typeof rollups & typeof sources & typeof stories

/** SQL name of every table in the schema. */
export type TableName = {
  [K in keyof Schema]: Schema[K] extends SQLiteTable ? Schema[K]["_"]["name"] : never
}[keyof Schema]

export type ColumnKind = "integer" | "real" | "text" | "json" | "boolean" | "timestamp"
export type LinkKind = "story" | "article" | "source" | "entity" | "theme"

export type ColumnMeta = {
  /** The Drizzle key, as rows and filters name it. */
  name: string
  dbName: string
  kind: ColumnKind
  /** The allowed values of an enum column. */
  values?: readonly string[]
}

export type TableMeta = {
  name: TableName
  table: SQLiteTable
  primaryKey: string[]
  columns: ColumnMeta[]
  /** Columns the dashboard may change one cell at a time. */
  editable: string[]
  /** The external-content FTS5 table over this one, keyed by its rowid (0001_fts.sql). */
  fts?: { table: string; columns: string[] }
  linksTo: Record<string, LinkKind>
}

/** Unix ms integers whose name does not end in `At`. */
const TIMESTAMPS = new Set(["at", "bucket", "firstSeen", "kevDateAdded", "euvdExploitedSince"])

const LINKS: Record<string, LinkKind> = {
  storyId: "story",
  mergedInto: "story",
  previousStoryId: "story",
  candidateStoryId: "story",
  articleId: "article",
  originId: "article",
  sourceId: "source",
}

const EDITABLE: Partial<Record<TableName, string[]>> = {
  sources: ["enabled", "pollSeconds", "tier", "category", "authoritative", "staleAfterDays", "name", "url"],
  stories: ["status"],
}

const FTS: Partial<Record<TableName, TableMeta["fts"]>> = {
  articles: { table: "articles_fts", columns: ["title", "snippet"] },
  stories: { table: "stories_fts", columns: ["title", "primary_entity", "summary", "why_matters"] },
}

const kindOf = (name: string, c: Column): ColumnKind => {
  switch (c.columnType) {
    case "SQLiteBoolean":
      return "boolean"
    case "SQLiteReal":
      return "real"
    case "SQLiteTextJson":
      return "json"
    case "SQLiteInteger":
      return name.endsWith("At") || TIMESTAMPS.has(name) ? "timestamp" : "integer"
    default:
      return "text"
  }
}

const describe = (table: SQLiteTable): TableMeta => {
  const name = getTableName(table) as TableName
  const entries = Object.entries(getTableColumns(table))
  const keyOf = new Map(entries.map(([k, c]) => [c, k]))
  const inline = entries.filter(([, c]) => c.primary).map(([k]) => k)
  return {
    name,
    table,
    primaryKey: inline.length
      ? inline
      : (getTableConfig(table).primaryKeys[0]?.columns.map((c) => keyOf.get(c) ?? c.name) ?? []),
    columns: entries.map(([k, c]) => ({
      name: k,
      dbName: c.keyAsName ? toSnakeCase(c.name) : c.name,
      kind: kindOf(k, c),
      values: c.enumValues,
    })),
    editable: EDITABLE[name] ?? [],
    fts: FTS[name],
    linksTo: Object.fromEntries(entries.flatMap(([k]) => (LINKS[k] ? [[k, LINKS[k]]] : []))),
  }
}

/** Every table in the schema files, by name. */
export const TABLES: TableMeta[] = [articles, delivery, ops, rollups, sources, stories]
  .flatMap((m) => Object.values(m).filter((v) => is(v, SQLiteTable)))
  .map(describe)
  .sort((a, b) => a.name.localeCompare(b.name))

export const tableMeta = (name: string) => TABLES.find((t) => t.name === name)

/** A column of `meta` with its Drizzle column; an Error when the table has no such column. */
export const columnOf = (meta: TableMeta, name: string) => {
  const c = meta.columns.find((col) => col.name === name)
  const column = getTableColumns(meta.table)[name]
  if (!c || !column) throw new Error(`Table ${meta.name} has no column ${name}`)
  return { ...c, column }
}

/** A URL or form string as the column's type; an Error when it is not one. Timestamps take unix ms or an ISO date. */
export const coerce = (c: ColumnMeta, raw: string) => {
  switch (c.kind) {
    case "boolean":
      if (raw === "true" || raw === "1") return true
      if (raw === "false" || raw === "0") return false
      break
    case "integer":
    case "real":
    case "timestamp": {
      const n = c.kind === "timestamp" && !/^-?\d+$/.test(raw) ? Date.parse(raw) : Number(raw)
      if (raw.trim() && Number.isFinite(n) && (c.kind === "real" || Number.isInteger(n))) return n
      break
    }
    default:
      if (!c.values || c.values.includes(raw)) return raw
  }
  throw new Error(`${c.name} cannot be "${raw}"`)
}

/** Joins a composite primary key in a row ID. */
const ID_SEP = "~"

/** The row's primary key as one URL-safe string. */
export const rowId = (meta: TableMeta, row: Record<string, unknown>) =>
  meta.primaryKey.map((k) => String(row[k])).join(ID_SEP)

/** The where clause for a row ID; an Error when the ID does not fit the key. */
export const rowWhere = (meta: TableMeta, id: string) => {
  const parts = id.split(ID_SEP)
  if (parts.length !== meta.primaryKey.length) throw new Error(`"${id}" is not a ${meta.name} row ID`)
  return and(
    ...meta.primaryKey.map((k, i) => {
      const c = columnOf(meta, k)
      return eq(c.column, coerce(c, parts[i] ?? ""))
    }),
  )
}
