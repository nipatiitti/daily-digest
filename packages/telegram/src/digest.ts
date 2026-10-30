import { DIGEST, sanitizeUserText } from "@digest/core"
import { escapeHtml } from "./html.ts"

const HELSINKI_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
})

const heading = (digestDate: string) => {
  const day = new Date(`${digestDate}T12:00:00Z`)
  const label = Number.isNaN(day.getTime()) ? digestDate : HELSINKI_DATE.format(day)
  return `<b>Daily digest for ${escapeHtml(label)}</b>`
}

export const renderEmptyDigest = (digestDate: string) => `${heading(digestDate)}\n\nNothing notable today.`

export const renderDigestHeader = (digestDate: string, count: number) =>
  `${heading(digestDate)}\n\n${count} ${count === 1 ? "story" : "stories"} today.`

export type ItemLink = { url: string; label: string }

export type DigestItem = {
  topic: "security" | "tech" | "world" | "fi"
  fiRelevance: number
  headline: string
  summary: string
  /** Independent origins, counted by code from the database. */
  origins: number
  links: ItemLink[]
  isUpdate: boolean
}

/** The article fields link picking reads; a story's articles from the database fit it. */
export type LinkArticle = {
  originId: number | null
  authoritative: boolean
  tier: string
  publishedAt: number
  domain: string
  canonicalUrl: string
  sourceName: string
}

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

/** Links chosen by code: origins only, authoritative first, one per domain, at most DIGEST.maxLinks. */
export const pickLinks = (list: LinkArticle[]): ItemLink[] => {
  const seen = new Set<string>()
  return [...list]
    .filter((a) => a.originId === null)
    .sort(
      (a, b) =>
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
  category: DigestItem["topic"]
  fiRelevance: number
  title: string
  summary: string | null
  independentOrigins: number
}

/** A stored story as one digest item, links picked from its articles. */
export const storyItem = (s: ItemStory, list: LinkArticle[], isUpdate: boolean): DigestItem => ({
  topic: s.category,
  fiRelevance: s.fiRelevance,
  headline: s.title,
  summary: s.summary ?? "",
  origins: s.independentOrigins,
  links: pickLinks(list),
  isUpdate,
})

const TAG: Record<DigestItem["topic"], string> = { security: "Security", tech: "Tech", world: "World", fi: "Finland" }

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

/** One Telegram message per item: tag and headline, one sentence, sources. */
export const renderDigestItem = (i: DigestItem) => {
  const tag = i.fiRelevance === 2 && i.topic !== "security" ? "Finland" : TAG[i.topic]
  const lines = [`<b>${i.isUpdate ? "Update: " : ""}${tag}: ${clean(i.headline)}</b>`]
  const summary = firstSentence(sanitizeUserText(i.summary))
  if (summary) lines.push(escapeHtml(summary))
  lines.push(sourcesLine(i))
  return lines.join("\n")
}
