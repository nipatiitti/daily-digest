import { canonicalUrl, domainOf, FETCH, type FeedItem, matchesFilter, parserFor, toSnippet } from "@digest/core"
import { type Db, getSource, insertArticles, type NewArticle, recordPoll, type Source } from "@digest/db"

export type FetchMessage = { sourceId: number }

const ACCEPT =
  "application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml;q=0.9, */*;q=0.8"
const DAY = 86_400_000

const log = (event: string, source: Source, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, source: source.slug, ...data }))

const toArticles = (source: Source, items: FeedItem[], baseUrl: string, now: number): NewArticle[] => {
  const cutoff = now - FETCH.maxItemAgeDays * DAY
  return items.flatMap((item) => {
    if (!matchesFilter(item, source.filterJson ?? null)) return []
    const publishedAt = Math.min(item.publishedAt ?? now, now)
    if (publishedAt < cutoff) return []
    const url = canonicalUrl(item.url, baseUrl)
    if (!url) return []
    return [
      {
        sourceId: source.id,
        guid: item.guid.slice(0, 500),
        canonicalUrl: url,
        domain: domainOf(url),
        title: item.title.replace(/\s+/g, " ").trim().slice(0, 500),
        snippet: toSnippet(item.summary, FETCH.snippetChars),
        lang: source.lang,
        publishedAt,
        fetchedAt: now,
      },
    ]
  })
}

/** Conditional GET, tolerant parse, INSERT OR IGNORE. Returns the new article IDs. */
export const fetchSource = async (db: Db, sourceId: number, now = Date.now()): Promise<number[]> => {
  const source = await getSource(db, sourceId)
  if (!source?.enabled) return []
  const parse = parserFor(source.kind, source.parser)
  if (!parse) {
    log("fetch_skipped", source, { reason: `no parser for ${source.kind}/${source.parser}` })
    return []
  }

  const headers: Record<string, string> = { "user-agent": FETCH.userAgent, accept: ACCEPT }
  if (source.etag) headers["if-none-match"] = source.etag
  if (source.lastModified) headers["if-modified-since"] = source.lastModified

  let res: Response
  try {
    res = await fetch(source.url, { headers, signal: AbortSignal.timeout(FETCH.timeoutMs) })
  } catch (e) {
    log("fetch_error", source, { error: String(e) })
    await recordPoll(db, source.id, now, { status: 0, newItems: 0 })
    return []
  }

  if (res.status === 304 || !res.ok) {
    await res.body?.cancel()
    if (!res.ok) log("fetch_http_error", source, { status: res.status })
    await recordPoll(db, source.id, now, { status: res.status, newItems: 0 })
    return []
  }

  let items: FeedItem[]
  try {
    items = parse(await res.text())
  } catch (e) {
    log("parse_error", source, { error: String(e) })
    await recordPoll(db, source.id, now, { status: 0, newItems: 0 })
    return []
  }

  const rows = toArticles(source, items, res.url || source.url, now)
  const newIds = rows.length > 0 ? await insertArticles(db, rows) : []
  await recordPoll(db, source.id, now, {
    status: res.status,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    newItems: newIds.length,
  })
  log("fetched", source, { items: items.length, kept: rows.length, new: newIds.length })
  return newIds
}
