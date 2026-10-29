import { env } from "cloudflare:workers"
import { ALERT, articleSetHash, bucketsBetween, DASHBOARD, hourBucket } from "@digest/core"
import {
  changeFactStatus,
  closeStory,
  FACT_STATUSES,
  followStory,
  getStory,
  mergeStory,
  recordAction,
  refreshStoryCounters,
  rollupSeries,
  storyDetail,
  storyEntityList,
  storyThemeChips,
} from "@digest/db"
import { error } from "@sveltejs/kit"
import { z } from "zod"
import { attempt } from "#lib/forms.ts"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { scoreBreakdown } from "#lib/server/llm.ts"
import { form, query } from "$app/server"

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

/** The whole story page in one round of reads after the story row. */
export const storyPage = query(positiveInt, async (id) => {
  const d = db()
  const story = await getStory(d, id)
  if (!story) error(404, `No story ${id}`)
  const now = Date.now()
  const from = Math.max(hourBucket(story.firstSeen), hourBucket(now) - DASHBOARD.storyChartDays * DAY_MS)
  const [detail, rollup, entities, themes] = await Promise.all([
    storyDetail(d, id, DASHBOARD.storyPageRows),
    rollupSeries(d, "story", String(id), from, now),
    storyEntityList(d, id, DASHBOARD.storyPageRows),
    storyThemeChips(d, [id]),
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
    entities,
    themes: themes.get(id) ?? [],
    follow: detail.follow,
    articlesPerHour: {
      labels: hours.map((b) => new Date(b).toISOString()),
      values: hours.map((b) => perHour.get(b) ?? 0),
    },
    scoreHistory: { labels: scores.map((s) => new Date(s.at).toISOString()), values: scores.map((s) => s.score) },
    articleCount: detail.articleCount,
    mergedIn: detail.mergedIn,
    breakdown: scoreBreakdown(story, detail.bestTier, alerts[0]?.at),
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

/** A write, then the page refreshes. */
const write = async (id: number, run: (by: string) => Promise<unknown>) => {
  await attempt(run)
  await storyPage(id).refresh()
}

const subject = z.object({ id: positiveInt })

export const closeForm = form(subject, ({ id }) => write(id, (by) => closeStory(db(), id, by)))

/** Counters as the process stage writes them, with the world velocity window. */
const counterOpts = { velocityWindowMinutes: ALERT.worldVelocityWindowMinutes }

export const mergeForm = form(subject.extend({ into: positiveInt }), ({ id, into }) =>
  write(id, (by) => mergeStory(db(), id, into, by, Date.now(), counterOpts)),
)

export const followForm = form(subject.extend({ days: positiveInt }), ({ id, days }) =>
  write(id, (by) => followStory(db(), id, by, Date.now() + days * DAY_MS)),
)

export const factStatusForm = form(subject.extend({ fact: positiveInt, status: z.enum(FACT_STATUSES) }), (f) =>
  write(f.id, (by) => changeFactStatus(db(), f.fact, f.id, f.status, by)),
)

/**
 * Starts StoryEval again on the current article set, hashed as the process stage hashes it; the suffix keeps the
 * instance ID unique. The audit row goes first, so a started evaluation always has one.
 */
export const requeueForm = form(subject, ({ id }) =>
  write(id, async (by) => {
    const d = db()
    const story = await getStory(d, id)
    if (!story) throw new Error(`Story ${id} does not exist`)
    if (story.status !== "active") throw new Error(`Story ${id} is ${story.status}, so it is not evaluated again`)
    const now = Date.now()
    const counters = await refreshStoryCounters(d, id, now, counterOpts)
    if (!counters) throw new Error(`Story ${id} has no articles to evaluate`)
    const params = { storyId: id, hash: articleSetHash(counters.articleIds) }
    await recordAction(d, { kind: "requeue", subjectKind: "story", subjectId: String(id), detailJson: params, by })
    await env.STORY_EVAL.create({ id: `story-${id}-${params.hash}-requeue-${now}`, params })
  }),
)
