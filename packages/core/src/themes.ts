import { cosine } from "./match.ts"

export type ThemeCandidate = { id: number; shared: number; cosine: number | null }

/** Entity and embedding candidates merged by id: most shared entities first, then highest cosine, at most `limit`. */
export const pickThemeCandidates = (o: {
  sharedEntities: { id: number; shared: number }[]
  nearest: { id: number; cosine: number }[]
  limit: number
}): ThemeCandidate[] => {
  const byId = new Map<number, ThemeCandidate>()
  for (const s of o.sharedEntities) byId.set(s.id, { id: s.id, shared: s.shared, cosine: null })
  for (const n of o.nearest) {
    const seen = byId.get(n.id)
    byId.set(n.id, { id: n.id, shared: seen?.shared ?? 0, cosine: Math.max(seen?.cosine ?? -1, n.cosine) })
  }
  return [...byId.values()].sort((a, b) => b.shared - a.shared || (b.cosine ?? -2) - (a.cosine ?? -2)).slice(0, o.limit)
}

/** The `k` themes nearest the embedding by cosine, nearest first. */
export const nearestThemes = (embedding: Float32Array, themes: { id: number; embedding: Float32Array }[], k: number) =>
  themes
    .map((t) => ({ id: t.id, cosine: cosine(embedding, t.embedding) }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, k)

/** Whether a provisional theme has earned a place on the dashboard. */
export const themeVisible = (
  theme: { storyCount: number },
  stories: { score: number | null }[],
  o: { minStories: number; minScore: number },
) => theme.storyCount >= o.minStories || stories.some((s) => (s.score ?? 0) >= o.minScore)
