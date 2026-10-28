import { sanitizeUserText } from "@digest/core"
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
