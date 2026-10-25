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
