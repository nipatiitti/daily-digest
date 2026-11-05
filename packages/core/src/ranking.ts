import { RANKING } from "./config.ts"
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

/** 1 for a zero or positive vote balance, lower per net downvote, never below the floor. */
export const votePenalty = (balance: number) =>
  balance >= 0 ? 1 : Math.max(RANKING.votePenaltyFloor, 1 + RANKING.votePenaltyPerDown * balance)

export const rankScore = (relevance: number, importance: number, freshness: number, penalty: number) =>
  (relevance / 100) * importance * freshness * penalty
