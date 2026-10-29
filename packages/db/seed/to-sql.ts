// Prints an idempotent upsert of the seed list. It touches config columns only, so
// re-running it never resets poll times, ETags or failure counts. `enabled` is set on
// insert only: after that the dashboard owns it.
//   node seed/to-sql.ts > seed.sql && wrangler d1 execute digest --remote --file seed.sql
import { SOURCES, type SourceSeed } from "./sources.ts"

const COLUMNS: [keyof SourceSeed, string][] = [
  ["slug", "slug"],
  ["name", "name"],
  ["url", "url"],
  ["kind", "kind"],
  ["parser", "parser"],
  ["filterJson", "filter_json"],
  ["tier", "tier"],
  ["category", "category"],
  ["lang", "lang"],
  ["authoritative", "authoritative"],
  ["pollSeconds", "poll_seconds"],
  ["staleAfterDays", "stale_after_days"],
  ["enabled", "enabled"],
]

const DEFAULTS: Partial<SourceSeed> = {
  kind: "rss",
  parser: null,
  filterJson: null,
  lang: "en",
  authoritative: false,
  staleAfterDays: 3,
  enabled: true,
}

const literal = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "boolean") return v ? "1" : "0"
  if (typeof v === "number") return String(v)
  const s = typeof v === "string" ? v : JSON.stringify(v)
  return `'${s.replaceAll("'", "''")}'`
}

const names = COLUMNS.map(([, c]) => c)
const updates = names
  .filter((c) => c !== "slug" && c !== "enabled")
  .map((c) => `${c} = excluded.${c}`)
  .join(", ")

const lines = SOURCES.map((s) => {
  const row = { ...DEFAULTS, ...s }
  const values = COLUMNS.map(([k]) => literal(row[k])).join(", ")
  return `INSERT INTO sources (${names.join(", ")}) VALUES (${values}) ON CONFLICT (slug) DO UPDATE SET ${updates};`
})

process.stdout.write(`${lines.join("\n")}\n`)
