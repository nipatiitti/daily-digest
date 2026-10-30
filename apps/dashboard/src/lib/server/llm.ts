import { env } from "cloudflare:workers"
import {
  CONFIG_VERSION,
  credibilityFor,
  DASHBOARD,
  HOUR_MS,
  hourBucket,
  recencyFactor,
  rubricValue,
  SCORING,
  scoreTier,
  storyScore,
} from "@digest/core"
import {
  type ActionSubject,
  askHits,
  CATEGORIES,
  type Db,
  entityById,
  firstDeskBucket,
  getStory,
  type LlmPurpose,
  latestBrief,
  RUBRIC_DIMENSIONS,
  rollupTotals,
  type Story,
  storiesFirstSeenBetween,
  storiesJoinedSince,
  storiesWithFacts,
  storyDetail,
  storyFactsSince,
  themeById,
  themeDetail,
} from "@digest/db"
import {
  askDesk,
  compareSignals,
  compareStories,
  createLlm,
  explainScore,
  explainSpike,
  reviewMonth,
  type StreamCall,
} from "@digest/llm"
import { byKeyBucket } from "#lib/components/format.ts"
import { STREAM_NAMES } from "#lib/components/streams.ts"
import { DAY_MS, RANGES, rangeToWindow } from "#lib/range.ts"
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

/** A subject id in canonical digits, or null. */
const idOf = (s: string) => (/^[1-9]\d{0,15}$/.test(s) ? Number(s) : null)

/** Two ids in canonical form, lower first ("12-34"), or null. */
const pairOf = (s: string) => {
  const m = /^([1-9]\d{0,15})-([1-9]\d{0,15})$/.exec(s)
  const pair = [Number(m?.[1]), Number(m?.[2])] as const
  return m && pair[0] < pair[1] ? pair : null
}

/** The review window's start, and how many stories a review reads. */
const reviewSpan = (now: number) => ({ since: now - DASHBOARD.reviewDays * DAY_MS, limit: DASHBOARD.storiesPageSize })

type Answer = (d: Db, subjectId: string, now: number, question: string) => Promise<StreamCall | null>

/** Each button by purpose and subject kind; subject ids in any other spelling find nothing. */
const ANSWERS: Partial<Record<`${LlmPurpose} ${ActionSubject}`, Answer>> = {
  /** The story page's score breakdown: `12`. */
  "explain story": async (d, subjectId) => {
    const id = idOf(subjectId)
    if (id === null) return null
    const [story, detail] = await Promise.all([getStory(d, id), storyDetail(d, id, DASHBOARD.storyPageRows)])
    const b = story && scoreBreakdown(story, detail.bestTier, detail.gates.find((g) => g.gate === "alert")?.at)
    if (!story?.rubricJson || !b) return null
    return {
      ...explainScore({
        ...b,
        dims: story.rubricJson.dims,
        flags: story.rubricJson.flags,
        hoursSinceLastArticle: Math.max(0, b.at - story.lastArticleAt) / HOUR_MS,
        independentOrigins: story.independentOrigins,
        origins6h: story.origins6h,
      }),
      storyId: id,
    }
  },

  /** The front page chart over a range, `streams.7d`, in its buckets up to the last complete hour. */
  "explain cell": async (d, subjectId, now) => {
    const range = RANGES.find((r) => subjectId === `streams.${r}`)
    if (!range) return null
    const w = rangeToWindow(range, now)
    const bucketOf = (t: number) => Math.floor(t / w.bucketMs) * w.bucketMs
    const from = bucketOf(w.from || ((await firstDeskBucket(d)) ?? now))
    const rows = await rollupTotals(d, "stream", [...CATEGORIES], from, now, w.bucketMs)
    if (rows.length === 0) return null
    // The stories at or just before the highest stream count, the one the prompt asks about.
    const peak = rows.reduce((a, b) => (b.articles > a.articles ? b : a)).bucket
    const appeared = await storiesFirstSeenBetween(
      d,
      Math.max(from, peak - w.bucketMs),
      Math.min(now, peak + w.bucketMs),
      DASHBOARD.storiesPageSize,
    )
    const hourly = w.bucketMs === HOUR_MS
    // Hours back from the end of the last complete hour, days back from today.
    const end = hourly ? now : bucketOf(now)
    const ago = (t: number) => (end - bucketOf(t)) / w.bucketMs
    const buckets: number[] = []
    for (let b = from; b < now; b += w.bucketMs) buckets.push(b)
    const count = byKeyBucket(rows)
    return explainSpike({
      range,
      unit: hourly ? "hour" : "day",
      ago: buckets.map(ago),
      streams: CATEGORIES.map((c) => ({ name: STREAM_NAMES[c], counts: buckets.map((b) => count(c, b)) })),
      stories: appeared.map((s) => ({ ...s, appearedAgo: ago(s.firstSeen) })),
    })
  },

  /** Two stories, `12-34`. */
  "compare story": async (d, subjectId, now) => {
    const ids = pairOf(subjectId)
    if (!ids) return null
    const stories = await storiesWithFacts(d, [...ids], DASHBOARD.leadFacts)
    return stories.length === 2 ? compareStories(stories, now) : null
  },

  /** Two signals, `12-34`, each with what its page lists. */
  "compare theme": async (d, subjectId) => {
    const ids = pairOf(subjectId)
    if (!ids) return null
    const [a, b] = await Promise.all(
      ids.map(async (id) => {
        const [theme, detail] = await Promise.all([
          themeById(d, id),
          themeDetail(d, id, { stories: DASHBOARD.entityPageStories, entities: DASHBOARD.signalEntities, rows: 1 }),
        ])
        return theme && theme.mergedInto === null ? { ...theme, ...detail } : null
      }),
    )
    return a && b ? compareSignals([a, b]) : null
  },

  /** A story's facts over the review window: `12`. */
  "review story": async (d, subjectId, now) => {
    const id = idOf(subjectId)
    if (id === null) return null
    const [[story], facts] = await Promise.all([
      storiesWithFacts(d, [id], 0),
      storyFactsSince(d, id, reviewSpan(now).since, DASHBOARD.storyPageRows),
    ])
    if (!story || facts.length === 0) return null
    return { ...reviewMonth({ kind: "story", story, facts, days: DASHBOARD.reviewDays, now }), storyId: id }
  },

  /** The stories that joined a signal over the review window: `12`. */
  "review theme": async (d, subjectId, now) => {
    const id = idOf(subjectId)
    if (id === null) return null
    const [signal, stories] = await Promise.all([themeById(d, id), storiesJoinedSince(d, "theme", id, reviewSpan(now))])
    if (!signal || signal.mergedInto !== null || stories.length === 0) return null
    return reviewMonth({ kind: "signal", signal, stories, days: DASHBOARD.reviewDays, now })
  },

  /** The stories that met an entity over the review window, by entity id: `12`. */
  "review entity": async (d, subjectId, now) => {
    const id = idOf(subjectId)
    if (id === null) return null
    const [entity, stories] = await Promise.all([
      entityById(d, id),
      storiesJoinedSince(d, "entity", id, reviewSpan(now)),
    ])
    if (!entity || entity.mergedInto !== null || stories.length === 0) return null
    return reviewMonth({ kind: "entity", entity, stories, days: DASHBOARD.reviewDays, now })
  },

  /** A question to the whole desk: `desk`. */
  "ask cell": async (d, subjectId, now, question) => {
    if (subjectId !== "desk" || !question) return null
    const [hits, brief] = await Promise.all([
      askHits(d, question, {
        limit: DASHBOARD.storiesPageSize,
        factsEach: DASHBOARD.leadFacts,
        terms: DASHBOARD.askTerms,
      }),
      latestBrief(d),
    ])
    return askDesk({ question, now, brief: brief?.text ?? null, ...hits })
  },
}

/**
 * What Claude is asked about a subject, or null when there is no such subject or nothing to answer about it. Inputs
 * are read as of the start of this hour, so an answer stays cached within the hour unless its data changes.
 */
export const answerCall = async (
  purpose: LlmPurpose,
  subjectKind: ActionSubject,
  subjectId: string,
  question = "",
): Promise<StreamCall | null> =>
  (await ANSWERS[`${purpose} ${subjectKind}`]?.(db(), subjectId, hourBucket(Date.now()), question)) ?? null
