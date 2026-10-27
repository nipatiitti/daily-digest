// Fetches every seeded source with the real parser and prints one line per source:
// HTTP status, items parsed, items kept by the filter, newest item age, or the error.
//   node scripts/smoke-sources.ts            enabled sources
//   node scripts/smoke-sources.ts --all      every source, including disabled ones
import { FETCH, matchesFilter, parserFor } from "../packages/core/src/index.ts"
import { SOURCES } from "../packages/db/seed/sources.ts"

const all = process.argv.includes("--all")
const list = SOURCES.filter((s) => all || s.enabled !== false)

const age = (ms: number | null) => (ms === null ? "no date" : `${((Date.now() - ms) / 3_600_000).toFixed(1)} h`)

const check = async (s: (typeof SOURCES)[number]) => {
  const parse = parserFor(s.kind ?? "rss", s.parser ?? null)
  if (!parse) return `${s.slug}: SKIP no parser for ${s.kind}/${s.parser}`
  try {
    const res = await fetch(s.url, {
      headers: {
        "user-agent": FETCH.userAgent,
        accept: "application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH.timeoutMs),
    })
    const body = await res.text()
    if (!res.ok) return `${s.slug}: HTTP ${res.status} (${res.headers.get("content-type") ?? "?"})`
    const items = parse(body)
    const kept = items.filter((i) => matchesFilter(i, s.filterJson ?? null))
    const newest = kept.reduce<number | null>(
      (m, i) => (i.publishedAt !== null && (m === null || i.publishedAt > m) ? i.publishedAt : m),
      null,
    )
    const undated = kept.filter((i) => i.publishedAt === null).length
    return `${s.slug}: ${res.status} items=${items.length} kept=${kept.length} newest=${age(newest)}${undated ? ` undated=${undated}` : ""}`
  } catch (e) {
    return `${s.slug}: ERROR ${(e as Error).message}`
  }
}

const results = await Promise.all(list.map(check))
console.log(results.sort().join("\n"))
