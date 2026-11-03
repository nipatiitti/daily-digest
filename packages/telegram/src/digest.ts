import { aboutFinland, DIGEST, EDITION_LABEL, parseEditionKey, sanitizeUserText } from "@digest/core"
import { escapeHtml } from "./html.ts"

const HELSINKI_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
})

/** "Morning digest for Fri 30 Oct 2026" from an edition key (editionKey); the key itself when it is not one. */
const heading = (key: string) => {
  const parsed = parseEditionKey(key)
  const day = parsed ? new Date(`${parsed.date}T12:00:00Z`) : null
  if (!parsed || !day || Number.isNaN(day.getTime())) return `<b>Digest for ${escapeHtml(key)}</b>`
  return `<b>${EDITION_LABEL[parsed.edition]} digest for ${escapeHtml(HELSINKI_DATE.format(day))}</b>`
}

const part = (key: string) => parseEditionKey(key)?.edition ?? "morning"

export const renderEmptyDigest = (key: string) => `${heading(key)}\n\nNothing new this ${part(key)}.`

export const renderDigestHeader = (key: string, count: number) =>
  `${heading(key)}\n\n${count} ${count === 1 ? "story" : "stories"} this ${part(key)}.`

export type ItemLink = { url: string; label: string }

export type DigestItem = {
  /** Written by code: a thread, countries or an event type, or v1's topic. */
  tag: string
  headline: string
  summary: string
  /** Why the reader gets it, printed after the summary; null when obvious. */
  why: string | null
  /** Independent origins, counted by code from the database. */
  origins: number
  links: ItemLink[]
  isUpdate: boolean
}

/** The article fields link picking reads. */
export type LinkArticle = {
  originId: number | null
  /** The source's role is `official`. */
  official: boolean
  authoritative: boolean
  tier: string
  publishedAt: number
  domain: string
  canonicalUrl: string
  sourceName: string
}

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

/** Links chosen by code: origins only, official then authoritative first, one per domain, at most DIGEST.maxLinks. */
export const pickLinks = (list: LinkArticle[]): ItemLink[] => {
  const seen = new Set<string>()
  return [...list]
    .filter((a) => a.originId === null)
    .sort(
      (a, b) =>
        Number(b.official) - Number(a.official) ||
        Number(b.authoritative) - Number(a.authoritative) ||
        (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) ||
        a.publishedAt - b.publishedAt,
    )
    .filter((a) => {
      if (seen.has(a.domain)) return false
      seen.add(a.domain)
      return true
    })
    .slice(0, DIGEST.maxLinks)
    .map((a) => ({ url: a.canonicalUrl, label: a.sourceName }))
}

/** The story fields a digest item is built from. */
export type ItemStory = {
  category: "security" | "tech" | "world" | "fi"
  title: string
  summary: string | null
  independentOrigins: number
  /** With the extraction's entities (storyEntities), the Finland tag reads them besides the title. */
  primaryEntity?: string | null
  entities?: string[]
}

const TAG: Record<ItemStory["category"], string> = { security: "Security", tech: "Tech", world: "World", fi: "Finland" }

/** A stored story as one digest item, links picked from its articles; v1 articles carry no role, none is official. */
export const storyItem = (s: ItemStory, list: Omit<LinkArticle, "official">[], isUpdate: boolean): DigestItem => ({
  tag:
    s.category !== "security" && aboutFinland([s.title, s.primaryEntity, ...(s.entities ?? [])])
      ? "Finland"
      : TAG[s.category],
  headline: s.title,
  summary: s.summary ?? "",
  why: null,
  origins: s.independentOrigins,
  links: pickLinks(list.map((a) => ({ ...a, official: false }))),
  isUpdate,
})

const clean = (s: string) => escapeHtml(sanitizeUserText(s))

/** Trim to the first sentence so a long extraction never bloats the digest. */
const firstSentence = (s: string) => {
  const m = s.trim().match(/^[^.!?]*[.!?](?=\s|$)/)
  return m ? m[0] : s.trim()
}

/** Linked source names separated by commas, then "and N more" for the origins without a link. */
const sourcesLine = (i: DigestItem) => {
  const links = i.links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`)
  const more = i.origins - i.links.length
  if (links.length === 0) return `${i.origins} ${i.origins === 1 ? "source" : "sources"}`
  if (more > 0) links.push(`and ${more} more`)
  return links.join(", ")
}

/** One Telegram message per item: tag and headline, one sentence, the why clause in italics, sources. */
export const renderDigestItem = (i: DigestItem) => {
  const lines = [`<b>${i.isUpdate ? "Update: " : ""}${clean(i.tag)}: ${clean(i.headline)}</b>`]
  const summary = firstSentence(sanitizeUserText(i.summary))
  if (summary) lines.push(escapeHtml(summary))
  const why = i.why === null ? "" : sanitizeUserText(i.why)
  if (why) lines.push(`<i>${escapeHtml(why)}</i>`)
  lines.push(sourcesLine(i))
  return lines.join("\n")
}
