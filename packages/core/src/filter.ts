import type { FeedItem } from "./feed.ts"

/** Same shape as the db's SourceFilter; core doesn't import the db package. */
export type ItemFilter = {
  categories?: string[]
  titlePattern?: string
  textPattern?: string
  mode?: "all" | "any"
}

export const matchesFilter = (item: FeedItem, f: ItemFilter | null) => {
  if (!f) return true
  const checks: boolean[] = []
  if (f.categories?.length) {
    const wanted = f.categories.map((c) => c.toLowerCase())
    checks.push(item.categories.some((c) => wanted.includes(c.toLowerCase())))
  }
  if (f.titlePattern) checks.push(new RegExp(f.titlePattern, "i").test(item.title))
  if (f.textPattern) checks.push(new RegExp(f.textPattern, "i").test(`${item.title}\n${item.summary ?? ""}`))
  if (checks.length === 0) return true
  return f.mode === "any" ? checks.some(Boolean) : checks.every(Boolean)
}
