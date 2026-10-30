/** Two digests go out each UTC day; the morning one keeps the bare date so every older row stays a morning edition. */
export type Edition = "morning" | "afternoon"

/** An edition's name as a reader sees it. */
export const EDITION_LABEL: Record<Edition, string> = { morning: "Morning", afternoon: "Afternoon" }

const KEY = /^(\d{4}-\d{2}-\d{2})(-afternoon)?$/

/** What `digests.digest_date` and `deliveries.digest_date` store: `YYYY-MM-DD` or `YYYY-MM-DD-afternoon`. */
export const editionKey = (date: string, edition: Edition) => (edition === "morning" ? date : `${date}-afternoon`)

/** The UTC date and edition of a stored key, or null when it is not one. */
export const parseEditionKey = (key: string): { date: string; edition: Edition } | null => {
  const m = KEY.exec(key)
  if (!m?.[1]) return null
  return { date: m[1], edition: m[2] ? "afternoon" : "morning" }
}
