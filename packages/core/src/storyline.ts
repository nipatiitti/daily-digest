import { STORYLINE } from "./config.ts"
import { cosine } from "./match.ts"

/** What decides whether two events tell one running story: their gist centroid and their most mentioned entities. */
export type Storyline = { centroid: ArrayLike<number> | null; entities: string[] }

/** An event's storyline from its centroid and its entity keys, most mentioned first. */
export const storyline = (centroid: ArrayLike<number> | null, entityKeys: string[]): Storyline => ({
  centroid,
  entities: entityKeys.slice(0, STORYLINE.topEntities),
})

/**
 * Centroids at STORYLINE.cosine and STORYLINE.sharedEntities of their top entities in common: either signal alone
 * links unrelated stories, the gist through a shared genre, the entities through the country or leader in every story.
 */
export const sameStoryline = (a: Storyline, b: Storyline) => {
  if (!a.centroid || !b.centroid || cosine(a.centroid, b.centroid) < STORYLINE.cosine) return false
  const theirs = new Set(b.entities)
  return a.entities.filter((k) => theirs.has(k)).length >= STORYLINE.sharedEntities
}

/** STORYLINE.exposureFactor per recently sent item in the same storyline, never below STORYLINE.exposureFloor. */
export const exposurePenalty = (e: Storyline, sent: Storyline[]) =>
  Math.max(STORYLINE.exposureFloor, STORYLINE.exposureFactor ** sent.filter((s) => sameStoryline(e, s)).length)

/**
 * Up to `n` items, one at a time: each round takes the best score after STORYLINE.spreadFactor per item already
 * taken in the same storyline, so one running story cannot fill the list while others wait.
 */
export const spreadPick = <T>(xs: T[], n: number, line: (x: T) => Storyline, score: (x: T) => number): T[] => {
  const left = [...xs]
  const taken: T[] = []
  while (taken.length < n && left.length > 0) {
    let best = 0
    let bestScore = -1
    for (const [i, x] of left.entries()) {
      const same = taken.filter((y) => sameStoryline(line(x), line(y))).length
      const s = score(x) * STORYLINE.spreadFactor ** same
      if (s > bestScore) {
        best = i
        bestScore = s
      }
    }
    taken.push(...left.splice(best, 1))
  }
  return taken
}

/** A group number per item, in order: the group of the first earlier item in the same storyline, else a new one. */
export const storylineGroups = <T>(xs: T[], line: (x: T) => Storyline) => {
  const groups: number[] = []
  for (const [i, x] of xs.entries()) {
    const earlier = xs.slice(0, i).findIndex((y) => sameStoryline(line(x), line(y)))
    groups.push(earlier === -1 ? (groups.length === 0 ? 1 : Math.max(...groups) + 1) : (groups[earlier] ?? 1))
  }
  return groups
}
