import { ALERT, SCORING } from "./config.ts"
import type { Extraction } from "./schemas.ts"

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

export type RubricDims = Record<string, number>

/** 100 * sum(w_d * dim_d / 4), then the promotional, aggregator and evergreen caps. */
export const rubricValue = (dims: RubricDims, flags: Extraction["flags"]) => {
  let v = 0
  for (const [d, w] of Object.entries(SCORING.weights)) v += w * clamp(dims[d] ?? 0, 0, 4)
  v = (100 * v) / 4
  if (flags.promotional) v = Math.min(v, SCORING.caps.promotional)
  if (flags.aggregator) v = Math.min(v, SCORING.caps.aggregator)
  if (flags.evergreen) v = Math.min(v, SCORING.caps.evergreen)
  return v
}

export const credibilityFor = (bestTier: string | null) =>
  bestTier === null ? SCORING.unknownCredibility : (SCORING.credibilityByTier[bestTier] ?? SCORING.unknownCredibility)

export const recencyFactor = (lastArticleAt: number, now: number) =>
  0.5 ** (Math.max(0, now - lastArticleAt) / (SCORING.recencyHalfLifeHours * 3_600_000))

export type ScoreInput = {
  rubric: number
  bestTier: string | null
  lastArticleAt: number
  independentOrigins: number
  origins6h: number
  now: number
}

/** rubric * credibility * recency + min(15, 5 log2(1 + origins)) + velocity bonus. */
export const storyScore = (s: ScoreInput) => {
  const base = s.rubric * credibilityFor(s.bestTier) * recencyFactor(s.lastArticleAt, s.now)
  const origins = Math.min(SCORING.originBonusMax, 5 * Math.log2(1 + Math.max(0, s.independentOrigins)))
  const velocity = Math.min(SCORING.velocityBonusMax, SCORING.velocityBonusPerOrigin * Math.max(0, s.origins6h))
  return Math.round((base + origins + velocity) * 10) / 10
}

export const scoreTier = (score: number) => SCORING.tierBounds.filter((b) => score >= b).length

/** Digest ranking only. */
export const nordicBoost = (fiRelevance: number) => SCORING.nordicBoost[fiRelevance] ?? 0

export type Majorness = {
  breadth: number
  kev: boolean
  exploitedBy: string | null
  emergencyPatch: boolean
  maxEpss: number | null
}

/** Security majorness: Breadth 4 and at least one exploitation or urgency signal. */
export const securityMajor = (m: Majorness) => {
  if (m.breadth < 4) return []
  const reasons: string[] = []
  if (m.kev) reasons.push("kev")
  if (m.exploitedBy && /vendor|cert|csirt|ncsc|cisa|microsoft|google|apple|cisco|fortinet|palo/i.test(m.exploitedBy)) {
    reasons.push(`exploited:${m.exploitedBy}`)
  }
  if (m.emergencyPatch) reasons.push("emergency-patch")
  if ((m.maxEpss ?? 0) >= SCORING.epssMajor) reasons.push(`epss=${m.maxEpss}`)
  return reasons
}

export type AlertInput = {
  topic: string
  score: number
  major: string[]
  worldScale: number
  independentOrigins: number
  authoritativeCount: number
  origins30m: number
  injectionOnlyAuthority: boolean
}

/** Alert gate: score, majorness or scale, verification, and velocity for non-authoritative world stories. */
export const alertGate = (a: AlertInput): { pass: boolean; reasons: string[] } => {
  const failures: string[] = []
  if (a.score < ALERT.minScore) failures.push(`score ${a.score} < ${ALERT.minScore}`)
  const isMajor = a.topic === "world" ? a.worldScale >= 4 : a.major.length > 0
  if (!isMajor) failures.push(a.topic === "world" ? "scale < 4" : "not major")
  const verified = a.independentOrigins >= 2 || (a.authoritativeCount >= 1 && !a.injectionOnlyAuthority)
  if (!verified) failures.push("unverified")
  if (a.topic === "world" && a.authoritativeCount === 0 && a.origins30m < ALERT.worldVelocityOrigins) {
    failures.push(`velocity ${a.origins30m} < ${ALERT.worldVelocityOrigins}`)
  }
  if (failures.length > 0) return { pass: false, reasons: failures }
  return { pass: true, reasons: [...a.major, `score=${a.score}`, `origins=${a.independentOrigins}`] }
}

const KEY_TYPES = new Set(["severity", "scope", "attribution", "casualties", "patch_status", "exploitation"])

export type UpdateInput = {
  newKeyFacts: { type: string; salience: number; label: "new" | "contradicting" }[]
  previousTier: number | null
  tier: number
  previousOrigins: number | null
  origins: number
}

/** Material update: a key-type new or contradicting fact with salience >= 2, a tier crossing, or +5 origins. */
export const materialUpdate = (u: UpdateInput) => {
  const reasons: string[] = []
  for (const f of u.newKeyFacts) {
    if (KEY_TYPES.has(f.type) && f.salience >= ALERT.materialSalience) reasons.push(`${f.label}:${f.type}`)
  }
  if (u.previousTier !== null && u.tier !== u.previousTier) reasons.push(`tier ${u.previousTier} -> ${u.tier}`)
  if (u.previousOrigins !== null && u.origins - u.previousOrigins >= ALERT.materialOriginJump) {
    reasons.push(`origins +${u.origins - u.previousOrigins}`)
  }
  return reasons
}
