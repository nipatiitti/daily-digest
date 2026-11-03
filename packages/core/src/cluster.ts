import { CLUSTER, RANKING, SUBSTANTIAL } from "./config.ts"
import type { MatchDecision } from "./match.ts"
import { HOUR_MS } from "./rollup.ts"

/** Enough independent reporting, or an official source, to score and send an event. */
export const isSubstantial = (e: { independentOrigins: number; officialCount: number }) =>
  e.independentOrigins >= SUBSTANTIAL.minOrigins || e.officialCount >= SUBSTANTIAL.minOfficial

/** Similarity after the same-source penalty: distance (1 - cos) is multiplied, then mapped back. */
export const penalisedSimilarity = (score: number, sameSource: boolean) =>
  sameSource ? 1 - CLUSTER.sameSourcePenalty * (1 - score) : score

/** Added to an event's best similarity for the entities (not places) it shares with the article. */
export const entityBoost = (shared: number) => Math.min(CLUSTER.entityBoostMax, CLUSTER.entityBoost * shared)

export const decideEvent = (best: number | null): MatchDecision => {
  if (best === null || best < CLUSTER.askCosine) return "new"
  return best >= CLUSTER.joinCosine ? "join" : "ask"
}

/** Normalised mean of vectors weighted by member count: a stored centroid plus new members, or two merged centroids. */
export const weightedMean = (parts: { v: ArrayLike<number>; n: number }[]) => {
  const out = new Float32Array(parts[0]?.v.length ?? 0)
  for (const { v, n } of parts) for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (v[i] ?? 0) * n
  const norm = Math.hypot(...out)
  return norm === 0 ? out : out.map((x) => x / norm)
}

/** Most frequent first; ties keep first-seen order. */
const byFrequency = <T>(xs: T[]) => {
  const counts = new Map<T, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([x]) => x)
}

type CounterMember<T extends string> = {
  originArticleId: number | null
  sourceId: number
  sourceRole: string
  publishedAt: number
  titleEn: string
  gist: string
  countries: string[]
  eventType: T
  advisory: boolean
  roundup: boolean
  promotional: boolean
}

/** Reporting of its own: not a roundup, not promotional, not from an aggregator. */
const independent = (m: CounterMember<string>) => !m.roundup && !m.promotional && m.sourceRole !== "aggregator"

/**
 * An event's counters, title and gist from its members, earliest published first; null without members. Only
 * independent origins count toward `independentOrigins` and `origins6h`.
 */
export const eventCounters = <T extends string>(members: CounterMember<T>[]) => {
  const first = members[0]
  const last = members.at(-1)
  if (!first || !last) return null
  const origins = members.filter((m) => m.originArticleId === null)
  const counted = origins.filter(independent)
  const lead = origins[0] ?? first
  return {
    title: lead.titleEn,
    gist: lead.gist,
    firstSeen: first.publishedAt,
    lastArticleAt: last.publishedAt,
    articleCount: members.length,
    independentOrigins: counted.length,
    uniqueSources: new Set(members.map((m) => m.sourceId)).size,
    officialCount: new Set(members.filter((m) => m.sourceRole === "official").map((m) => m.sourceId)).size,
    origins6h: counted.filter((m) => m.publishedAt >= last.publishedAt - RANKING.velocityHours * HOUR_MS).length,
    advisoryOnly: origins.length > 0 && origins.every((m) => m.sourceRole === "advisory" || m.advisory),
    countriesJson: byFrequency(members.flatMap((m) => m.countries)),
    eventType: byFrequency(members.map((m) => m.eventType))[0] ?? lead.eventType,
  }
}
