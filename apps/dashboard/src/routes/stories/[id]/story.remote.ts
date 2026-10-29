import { env } from "cloudflare:workers"
import {
  bucketsBetween,
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
import {
  changeFactStatus,
  closeStory,
  FACT_STATUSES,
  followStory,
  getStory,
  mergeStory,
  RUBRIC_DIMENSIONS,
  recordAction,
  rollupSeries,
  type Story,
  storyDetail,
  TIERS,
} from "@digest/db"
import { error, invalid } from "@sveltejs/kit"
import { z } from "zod"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { form, getRequestEvent, query } from "$app/server"

/** IDs and day counts. */
const positiveInt = z.number().int().positive()

/** The score in an alert gate's reasons: "score=72.4" on a pass, "score 72.4 < 90" on a low-score fail. */
const gateScore = (reasons: string[]) => {
  for (const r of reasons) {
    const m = /^score[= ](\d+(?:\.\d+)?)/.exec(r)
    if (m) return Number(m[1])
  }
  return null
}

/** Every term of core's score, recomputed from the stored rubric and counts as of `at`, the last evaluation. */
const scoreBreakdown = (story: Story, bestTier: string | null, at: number) => {
  const r = story.rubricJson
  if (!r) return null
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

/** The whole story page in one round of reads after the story row. */
export const storyPage = query(positiveInt, async (id) => {
  const d = db()
  const story = await getStory(d, id)
  if (!story) error(404, `No story ${id}`)
  const now = Date.now()
  const from = Math.max(hourBucket(story.firstSeen), hourBucket(now) - DASHBOARD.storyChartDays * DAY_MS)
  const [detail, rollup] = await Promise.all([
    storyDetail(d, id, DASHBOARD.storyPageRows),
    rollupSeries(d, "story", String(id), from, now),
  ])

  const perHour = new Map(rollup.map((r) => [r.bucket, r.articles]))
  const hours = bucketsBetween(from, now)
  const how = new Map<number, (typeof detail.matches)[number]>()
  for (const m of detail.matches) if (!how.has(m.articleId)) how.set(m.articleId, m)
  const titles = new Map(detail.articles.map((a) => [a.id, a.title]))
  const alerts = detail.gates.filter((g) => g.gate === "alert")
  const scores = alerts.toReversed().flatMap((g) => {
    const score = gateScore(g.reasonsJson)
    return score === null ? [] : [{ at: g.at, score }]
  })
  const votes = (deliveryId: number, vote: "up" | "down") =>
    detail.votes.find((v) => v.deliveryId === deliveryId && v.vote === vote)?.n ?? 0

  return {
    story,
    follow: detail.follow,
    articlesPerHour: {
      labels: hours.map((b) => new Date(b).toISOString()),
      values: hours.map((b) => perHour.get(b) ?? 0),
    },
    scoreHistory: { labels: scores.map((s) => new Date(s.at).toISOString()), values: scores.map((s) => s.score) },
    breakdown: scoreBreakdown(
      story,
      TIERS.find((t) => detail.articles.some((a) => a.tier === t)) ?? null,
      alerts[0]?.at ?? now,
    ),
    facts: FACT_STATUSES.map((status) => ({
      status,
      rows: detail.facts
        .filter((f) => f.status === status)
        .map((f) => ({
          ...f,
          supporting: f.supportingArticleIdsJson.map((aid) => ({ id: aid, title: titles.get(aid) ?? null })),
        })),
    })),
    articles: detail.articles.map((a) => ({ ...a, match: how.get(a.id) ?? null })),
    vulns: detail.vulns,
    gates: detail.gates,
    deliveries: detail.deliveries.map((dl) => ({ ...dl, up: votes(dl.id, "up"), down: votes(dl.id, "down") })),
    signals: detail.signals,
    audit: detail.audit,
  }
})

/** Runs a write as the signed-in user; a helper's Error becomes a form issue, then the page refreshes. */
const write = async (id: number, run: (by: string) => Promise<unknown>) => {
  try {
    await run(getRequestEvent().locals.user)
  } catch (e) {
    if (e instanceof Error) invalid(e.message)
    throw e
  }
  await storyPage(id).refresh()
}

const subject = z.object({ id: positiveInt })

export const closeForm = form(subject, ({ id }) => write(id, (by) => closeStory(db(), id, by)))

export const mergeForm = form(subject.extend({ into: positiveInt }), ({ id, into }) =>
  write(id, (by) => mergeStory(db(), id, into, by, Date.now())),
)

export const followForm = form(subject.extend({ days: positiveInt }), ({ id, days }) =>
  write(id, (by) => followStory(db(), id, by, Date.now() + days * DAY_MS)),
)

export const factStatusForm = form(subject.extend({ fact: positiveInt, status: z.enum(FACT_STATUSES) }), (f) =>
  write(f.id, (by) => changeFactStatus(db(), f.fact, f.status, by)),
)

/** Starts StoryEval again on the current article set; the suffix keeps the instance ID unique. */
export const requeueForm = form(subject, ({ id }) =>
  write(id, async (by) => {
    const d = db()
    const story = await getStory(d, id)
    if (!story?.extractionHash) throw new Error(`Story ${id} has not cleared the evidence bar, so it has no hash`)
    const params = { storyId: id, hash: story.extractionHash }
    await env.STORY_EVAL.create({ id: `story-${id}-${params.hash}-requeue-${Date.now()}`, params })
    await recordAction(d, { kind: "requeue", subjectKind: "story", subjectId: String(id), detailJson: params, by })
  }),
)
