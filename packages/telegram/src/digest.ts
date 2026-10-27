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
  return `<b>Daily digest · ${escapeHtml(label)}</b>`
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
  whyMatters: string
  /** Independent origins and the authoritative source names, rendered by code from the database. */
  origins: number
  authoritative: string[]
  links: ItemLink[]
  isUpdate: boolean
}

const TAG: Record<DigestItem["topic"], string> = { security: "Security", tech: "Tech", world: "World", fi: "Finland" }

const badge = (i: DigestItem) => {
  const parts = [`${i.origins} ${i.origins === 1 ? "source" : "sources"}`, ...i.authoritative.slice(0, 2)]
  return parts.map(escapeHtml).join(" · ")
}

const clean = (s: string) => escapeHtml(sanitizeUserText(s))

/** One Telegram message per item: tag, headline, summary, why it matters, badge, links. */
export const renderDigestItem = (i: DigestItem) => {
  const tag = i.fiRelevance === 2 && i.topic !== "security" ? "Finland" : TAG[i.topic]
  const lines = [
    `<b>${i.isUpdate ? "Update: " : ""}[${tag}] ${clean(i.headline)}</b>`,
    clean(i.summary),
    `<i>Why it matters:</i> ${clean(i.whyMatters)}`,
    badge(i),
  ]
  if (i.links.length > 0) {
    lines.push(i.links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(" · "))
  }
  return lines.join("\n")
}
