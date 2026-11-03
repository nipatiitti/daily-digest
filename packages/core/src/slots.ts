import { DIGEST } from "./config.ts"

export type SlotCandidate = {
  storyId: number
  topic: "security" | "tech" | "world"
  score: number
  /** aboutFinland over the story's title and extracted entities. */
  finland: boolean
  primaryEntity: string | null
  /** Source of the story's leading article; at most two items per source. */
  mainSourceId: number
}

const rank = (c: SlotCandidate) => c.score + (c.finland ? DIGEST.finlandBoost : 0)

/**
 * Greedy fill within the caps: Finland stories take the Finland slots first with the lower floor, and
 * overflow into their topic group; then 3 tech/security and 2 world.
 * At most one story per primary entity and two per source. Never pads. Picks come back in rank order.
 */
export const fillSlots = <T extends SlotCandidate>(candidates: T[]): T[] => {
  const ranked = [...candidates].sort((a, b) => rank(b) - rank(a))
  const picked: T[] = []
  const entities = new Set<string>()
  const perSource = new Map<number, number>()
  let techSecurity = 0
  let world = 0
  let fi = 0

  const admit = (c: T) => {
    const entity = c.primaryEntity?.trim().toLowerCase()
    if (entity && entities.has(entity)) return false
    if ((perSource.get(c.mainSourceId) ?? 0) >= DIGEST.maxPerSource) return false
    picked.push(c)
    if (entity) entities.add(entity)
    perSource.set(c.mainSourceId, (perSource.get(c.mainSourceId) ?? 0) + 1)
    return true
  }

  for (const c of ranked) {
    if (picked.length >= DIGEST.maxItems) break
    if (c.finland && c.score >= DIGEST.fiFloor && fi < DIGEST.slots.fi) {
      if (admit(c)) fi++
      continue
    }
    if (c.score < DIGEST.floor) continue
    if (c.topic === "world") {
      if (world < DIGEST.slots.world && admit(c)) world++
    } else if (techSecurity < DIGEST.slots.techSecurity && admit(c)) techSecurity++
  }
  return picked
}
