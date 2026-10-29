import { sanitizeUserText } from "@digest/core"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const pad2 = (n: number) => String(n).padStart(2, "0")

/** Day and short month in UTC: "27 Oct". */
export const fmtDate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "06:12Z" when `ms` falls on the same UTC day as `now`, else "26 Oct 06:12Z". */
export const fmtTime = (ms: number, now = Date.now()) => {
  const d = new Date(ms)
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`
  const sameDay = d.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)
  return sameDay ? time : `${fmtDate(ms)} ${time}`
}

/** Rounded integer, thousands split by a thin space, negatives with a true minus sign. */
export const fmtInt = (n: number) => {
  const r = Math.round(n)
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return r < 0 ? `−${digits}` : digits
}

/** Article counts from rollup rows, looked up by key and bucket; 0 for a missing row. */
export const byKeyBucket = (rows: { key: string; bucket: number; articles: number }[]) => {
  const got = new Map(rows.map((r) => [`${r.key}/${r.bucket}`, r.articles]))
  return (key: string | number, bucket: number) => got.get(`${key}/${bucket}`) ?? 0
}

/** "SIG-0412". */
export const padId = (prefix: string, id: number) => `${prefix}-${String(id).padStart(4, "0")}`

/**
 * Model text cut at its SIG-0412 and STY-1234 ids, padded or not, each id in its padded form with the signal or story
 * page it links to (`href` null for plain text), after the forbidden glyphs are dropped.
 */
export const idSegments = (text: string) => {
  // split puts each id's two captures, kind and number, after the text before it: text, kind, number, text, ...
  const parts = sanitizeUserText(text).split(/\b(SIG|STY)-0*(\d+)\b/)
  const out: { text: string; href: string | null }[] = []
  for (let i = 0; i < parts.length; i += 3) {
    out.push({ text: parts[i] ?? "", href: null })
    const kind = parts[i + 1]
    const id = Number(parts[i + 2])
    if (kind) out.push({ text: padId(kind, id), href: `/${kind === "SIG" ? "signals" : "stories"}/${id}` })
  }
  return out
}
