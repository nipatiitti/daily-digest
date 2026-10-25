import { XMLParser } from "fast-xml-parser"

export type FeedItem = {
  guid: string
  url: string
  title: string
  summary: string | null
  categories: string[]
  /** Unix ms; null when the feed gives no parseable date. */
  publishedAt: number | null
}

export class FeedParseError extends Error {}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  // dc:date → date, content:encoded → encoded, rdf:RDF → RDF
  removeNSPrefix: true,
  htmlEntities: true,
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry" || name === "link" || name === "category",
})

type Node = unknown

const text = (v: Node): string | null => {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return text(v[0])
  if (typeof v === "string") return v.trim() || null
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (typeof v === "object") {
    const o = v as Record<string, Node>
    return text(o["#text"]) ?? text(o["@term"])
  }
  return null
}

const list = (v: Node): Node[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

const date = (v: Node) => {
  const s = text(v)
  if (!s) return null
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : ms
}

const strings = (v: Node) => list(v).flatMap((c) => text(c) ?? [])

const rssItem = (n: Record<string, Node>): Partial<FeedItem> => {
  const link = text(n.link)
  const guid = text(n.guid)
  const permaGuid = guid && /^https?:\/\//.test(guid) ? guid : null
  return {
    guid: guid ?? link ?? undefined,
    url: link ?? permaGuid ?? undefined,
    title: text(n.title) ?? undefined,
    summary: text(n.description) ?? text(n.encoded),
    categories: strings(n.category).concat(strings(n.subject)),
    publishedAt: date(n.pubDate) ?? date(n.date) ?? date(n.updated),
  }
}

const atomEntry = (n: Record<string, Node>): Partial<FeedItem> => {
  const links = list(n.link) as Record<string, Node>[]
  const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0]
  const url = alt ? text(alt["@href"]) : null
  return {
    guid: text(n.id) ?? url ?? undefined,
    url: url ?? undefined,
    title: text(n.title) ?? undefined,
    summary: text(n.summary) ?? text(n.content),
    categories: strings(n.category),
    publishedAt: date(n.published) ?? date(n.updated) ?? date(n.date),
  }
}

const complete = (items: Partial<FeedItem>[]): FeedItem[] =>
  items.flatMap((i) =>
    i.guid && i.url && i.title
      ? [
          {
            guid: i.guid,
            url: i.url,
            title: i.title,
            summary: i.summary ?? null,
            categories: i.categories ?? [],
            publishedAt: i.publishedAt ?? null,
          },
        ]
      : [],
  )

/** RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed. */
export const parseFeed = (body: string): FeedItem[] => {
  const trimmed = body.trimStart()
  if (trimmed.startsWith("{")) return parseJsonFeed(trimmed)

  let doc: Record<string, Node>
  try {
    doc = xml.parse(trimmed) as Record<string, Node>
  } catch (e) {
    throw new FeedParseError(`invalid XML: ${(e as Error).message}`)
  }
  const rss = doc.rss as { channel?: Record<string, Node> } | undefined
  if (rss?.channel) return complete(list(rss.channel.item).map((n) => rssItem(n as Record<string, Node>)))
  const rdf = doc.RDF as Record<string, Node> | undefined
  if (rdf) return complete(list(rdf.item).map((n) => rssItem(n as Record<string, Node>)))
  const atom = doc.feed as Record<string, Node> | undefined
  if (atom) return complete(list(atom.entry).map((n) => atomEntry(n as Record<string, Node>)))
  throw new FeedParseError("not an RSS, RDF or Atom document")
}

const parseJson = (body: string) => {
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch (e) {
    throw new FeedParseError(`invalid JSON: ${(e as Error).message}`)
  }
}

const parseJsonFeed = (body: string): FeedItem[] => {
  const doc = parseJson(body)
  if (!Array.isArray(doc.items)) throw new FeedParseError("not a JSON Feed")
  return complete(
    (doc.items as Record<string, Node>[]).map((n) => ({
      guid: text(n.id) ?? text(n.url) ?? undefined,
      url: text(n.url) ?? text(n.external_url) ?? undefined,
      title: text(n.title) ?? undefined,
      summary: text(n.summary) ?? text(n.content_text) ?? text(n.content_html),
      categories: strings(n.tags),
      publishedAt: date(n.date_published) ?? date(n.date_modified),
    })),
  )
}

/** CISA Known Exploited Vulnerabilities catalogue. */
const parseKev = (body: string): FeedItem[] => {
  const doc = parseJson(body)
  if (!Array.isArray(doc.vulnerabilities)) throw new FeedParseError("no vulnerabilities array")
  return complete(
    (doc.vulnerabilities as Record<string, Node>[]).map((v) => {
      const cve = text(v.cveID)
      return {
        guid: cve ?? undefined,
        url: cve ? `https://www.cve.org/CVERecord?id=${cve}` : undefined,
        title: cve ? `${cve}: ${text(v.vulnerabilityName) ?? text(v.product) ?? "exploited vulnerability"}` : undefined,
        summary: text(v.shortDescription),
        categories: strings(v.vendorProject),
        publishedAt: date(v.dateAdded),
      }
    }),
  )
}

const PARSERS: Record<string, (body: string) => FeedItem[]> = { kev: parseKev }

/** Null when the source needs a parser that isn't implemented yet. */
export const parserFor = (kind: string, parser: string | null) => {
  if (parser) return PARSERS[parser] ?? null
  return kind === "rss" || kind === "json" ? parseFeed : null
}

/** Plain-text snippet from an HTML summary. */
export const toSnippet = (html: string | null, max: number) => {
  if (!html) return null
  const plain = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return null
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}
