export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "for", "and", "is", "at", "by", "with", "from", "as"])

export const titleTokens = (title: string) =>
  new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t)),
  )

export const titleJaccard = (a: string, b: string) => {
  const ta = titleTokens(a)
  const tb = titleTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export type MatchDecision = "join" | "new" | "ask"

/** Stable key for an article set; a changed key means the set changed. */
export const articleSetHash = (ids: number[]) => {
  let h = 2166136261
  for (const id of [...ids].sort((a, b) => a - b)) {
    h ^= id
    h = Math.imul(h, 16777619) >>> 0
  }
  return `${ids.length}-${h.toString(16)}`
}
