import { cosine } from "./match.ts"

export type ThreadCandidate = { id: number; shared: number; cosine: number | null }

/** Entity and centroid candidates merged by id: most shared entities first, then highest cosine, at most `limit`. */
export const pickThreadCandidates = (o: {
  sharedEntities: { id: number; shared: number }[]
  nearest: { id: number; cosine: number }[]
  limit: number
}): ThreadCandidate[] => {
  const byId = new Map<number, ThreadCandidate>()
  for (const s of o.sharedEntities) byId.set(s.id, { id: s.id, shared: s.shared, cosine: null })
  for (const n of o.nearest) {
    const seen = byId.get(n.id)
    byId.set(n.id, { id: n.id, shared: seen?.shared ?? 0, cosine: Math.max(seen?.cosine ?? -1, n.cosine) })
  }
  return [...byId.values()].sort((a, b) => b.shared - a.shared || (b.cosine ?? -2) - (a.cosine ?? -2)).slice(0, o.limit)
}

/** The `k` threads nearest the centroid by cosine, nearest first. */
export const nearestThreads = (centroid: Float32Array, threads: { id: number; centroid: Float32Array }[], k: number) =>
  threads
    .map((t) => ({ id: t.id, cosine: cosine(centroid, t.centroid) }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, k)
