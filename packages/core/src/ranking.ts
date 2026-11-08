import { EDITION, INTEREST, RANKING } from "./config.ts"
import { HOUR_MS } from "./rollup.ts"

const saturate = (x: number, half: number) => Math.max(0, x) / (Math.max(0, x) + half)

/**
 * 0 to 1 from independent origins, their home countries (breadth), outlet diversity and velocity, plus a bonus for
 * an official source.
 */
export const importance = (e: {
  independentOrigins: number
  sourceCountries: number
  uniqueSources: number
  officialCount: number
  origins6h: number
}) => {
  const { weights: w } = RANKING
  const base =
    w.origins * saturate(e.independentOrigins, RANKING.originsHalf) +
    w.countries * saturate(e.sourceCountries, RANKING.countriesHalf) +
    w.sources * saturate(e.uniqueSources, RANKING.sourcesHalf) +
    w.velocity * saturate(e.origins6h, RANKING.velocityHalf)
  return Math.min(1, base + (e.officialCount > 0 ? RANKING.officialBonus : 0))
}

/** Halves every RANKING.freshnessHalfLifeHours since the latest article. */
export const freshness = (lastArticleAt: number, now: number) =>
  0.5 ** (Math.max(0, now - lastArticleAt) / (RANKING.freshnessHalfLifeHours * HOUR_MS))

/** The interest lift for a level 0 to 3: never below 1. */
export const boost = (level: number) => INTEREST.boost[Math.max(0, Math.min(3, Math.round(level)))] ?? 1

/** An event's gate: its significance times the interest lift, at most 100. */
export const gateOf = (significance: number, level: number) => Math.min(100, Math.round(significance * boost(level)))

/** EDITION.corroborationFloor at no corroboration, 1 at full importance. */
export const corroboration = (importance: number) =>
  EDITION.corroborationFloor + (1 - EDITION.corroborationFloor) * Math.max(0, Math.min(1, importance))

/**
 * A group goes out when its gate reaches EDITION.minSignificance and, when it is a story, its change since the last
 * brief is major. A storyless thread or event needs only the gate.
 */
export const qualifies = (g: { gate: number; story: boolean; change: "none" | "minor" | "major" | null }) =>
  g.gate >= EDITION.minSignificance && (!g.story || g.change === "major")

/** significance x boost ^ EDITION.rankBoost / 100 x corroboration x freshness. */
export const itemScore = (significance: number, level: number, importance: number, freshness: number) =>
  ((significance * boost(level) ** EDITION.rankBoost) / 100) * corroboration(importance) * freshness
