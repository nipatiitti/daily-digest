import { MATCH } from "./config.ts"

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

const CVE = /\bCVE-\d{4}-\d{4,7}\b/gi

export const extractCveIds = (text: string) => [...new Set((text.match(CVE) ?? []).map((c) => c.toUpperCase()))]

/** Similarity after the same-source penalty: distance (1 - cos) is multiplied, then mapped back. */
export const penalised = (score: number, sameSource: boolean) =>
  sameSource ? 1 - MATCH.sameSourcePenalty * (1 - score) : score

export type MatchDecision = "join" | "new" | "ask"

export const decideMatch = (bestScore: number | null): MatchDecision => {
  if (bestScore === null || bestScore < MATCH.newStoryCosine) return "new"
  if (bestScore >= MATCH.joinCosine) return "join"
  return "ask"
}

/** Stable key for a story's article set; a changed key means StoryEval has new input. */
export const articleSetHash = (ids: number[]) => {
  let h = 2166136261
  for (const id of [...ids].sort((a, b) => a - b)) {
    h ^= id
    h = Math.imul(h, 16777619) >>> 0
  }
  return `${ids.length}-${h.toString(16)}`
}
