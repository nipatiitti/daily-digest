import { env } from "cloudflare:workers"
import {
  CONFIG_VERSION,
  credibilityFor,
  DASHBOARD,
  hourBucket,
  recencyFactor,
  rubricValue,
  SCORING,
  scoreTier,
  storyScore,
} from "@digest/core"
import { type ActionSubject, getStory, type LlmPurpose, RUBRIC_DIMENSIONS, type Story, storyDetail } from "@digest/db"
import { createLlm, explainScore, type StreamCall } from "@digest/llm"
import { db } from "./db.ts"

/** Claude spend per UTC day on dashboard answers, counted over dashboard purposes only. */
export const answerCapUsd = () => Number(env.DASHBOARD_SPEND_CAP_USD) || DASHBOARD.spendCapUsd

/** Claude for on-demand answers; null until ANTHROPIC_API_KEY is set. */
export const llm = () =>
  env.ANTHROPIC_API_KEY
    ? createLlm({ apiKey: env.ANTHROPIC_API_KEY, db: db(), dailyCapUsd: Number(env.DAILY_SPEND_CAP_USD) })
    : null

/**
 * Every term of core's score, recomputed from the rubric stored at the last evaluation with the story's current
 * counts and best tier, and recency as of the last alert gate, else the start of this hour. It can differ from the
 * stored score. The story page shows it and "Explain the score" explains the same numbers.
 */
export const scoreBreakdown = (story: Story, bestTier: string | null, lastAlertAt: number | undefined) => {
  const r = story.rubricJson
  if (!r) return null
  const at = lastAlertAt ?? hourBucket(Date.now())
  const input = {
    rubric: r.value,
    bestTier,
    lastArticleAt: story.lastArticleAt,
    independentOrigins: story.independentOrigins,
    origins6h: story.origins6h,
    now: at,
  }
  const uncapped = rubricValue(r.dims, { promotional: false, aggregator: false, evergreen: false, opinion: false })
  const score = storyScore(input)
  return {
    dims: RUBRIC_DIMENSIONS.map((d) => ({
      label: `${d[0]?.toUpperCase()}${d.slice(1)}, weight ${SCORING.weights[d]}`,
      values: [{ name: "Points", value: r.dims[d] }],
    })),
    uncapped,
    rubric: r.value,
    caps: Object.entries(SCORING.caps).flatMap(([flag, cap]) =>
      r.flags[flag as keyof typeof r.flags] ? [{ flag, cap, applied: uncapped > cap }] : [],
    ),
    bestTier,
    credibility: credibilityFor(bestTier),
    at,
    recency: recencyFactor(story.lastArticleAt, at),
    // With a zero rubric the score is only its bonuses; zeroing one count leaves the other.
    originBonus: storyScore({ ...input, rubric: 0, origins6h: 0 }),
    velocityBonus: storyScore({ ...input, rubric: 0, independentOrigins: 0 }),
    score,
    tier: scoreTier(score),
    configVersion: CONFIG_VERSION,
  }
}

/** What Claude is asked about a subject, or null when there is no such subject or nothing to answer about it. */
export const answerCall = async (
  purpose: LlmPurpose,
  subjectKind: ActionSubject,
  subjectId: string,
): Promise<StreamCall | null> => {
  const id = Number(subjectId)
  if (purpose !== "explain" || subjectKind !== "story" || !Number.isSafeInteger(id)) return null
  const d = db()
  const [story, detail] = await Promise.all([getStory(d, id), storyDetail(d, id, DASHBOARD.storyPageRows)])
  const b = story && scoreBreakdown(story, detail.bestTier, detail.gates.find((g) => g.gate === "alert")?.at)
  if (!story?.rubricJson || !b) return null
  return {
    ...explainScore({
      ...b,
      dims: story.rubricJson.dims,
      flags: story.rubricJson.flags,
      hoursSinceLastArticle: Math.max(0, b.at - story.lastArticleAt) / 3_600_000,
      independentOrigins: story.independentOrigins,
      origins6h: story.origins6h,
    }),
    storyId: id,
  }
}
