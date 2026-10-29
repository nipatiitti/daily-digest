import { scoreTier } from "@digest/core"

export type SeverityLevel = 1 | 2 | 3 | 4 | 5

export const SEVERITY_WORDS = ["Quiet", "Low", "Elevated", "High", "Critical"] as const

/** Lit segment fill per level, index 0 is level 1. Full class names so Tailwind finds them. */
export const SEVERITY_FILLS = [
  "bg-sev-quiet",
  "bg-sev-low",
  "bg-sev-elevated",
  "bg-sev-high",
  "bg-sev-critical",
] as const

/** Story score to level with `SCORING.tierBounds`: below 45 Quiet, then Low, Elevated, High, Critical. Null is Quiet. */
export const severityLevel = (score: number | null) => (score === null ? 1 : scoreTier(score) + 1) as SeverityLevel
