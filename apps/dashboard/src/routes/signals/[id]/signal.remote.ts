import { bucketsBetween, DASHBOARD, HOUR_MS, THEME_NAME } from "@digest/core"
import {
  closeTheme,
  detachStoryTheme,
  mergeThemeInto,
  renameTheme,
  rollupTotals,
  themeById,
  themeDetail,
} from "@digest/db"
import { error, invalid, redirect } from "@sveltejs/kit"
import { z } from "zod"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { form, getRequestEvent, query } from "$app/server"

const positiveInt = z.number().int().positive()

/**
 * The signal page in one round of reads after the theme row; a merged theme redirects to the one it went into. The
 * spine runs from first seen, hourly while that is within the story chart's span and daily beyond it.
 */
export const signalPage = query(positiveInt, async (id) => {
  const d = db()
  const theme = await themeById(d, id)
  if (!theme) error(404, `No signal ${id}`)
  if (theme.mergedInto !== null) redirect(307, `/signals/${theme.mergedInto}`)
  const now = Date.now()
  const bucketMs = now - theme.firstSeen > DASHBOARD.storyChartDays * DAY_MS ? DAY_MS : HOUR_MS
  const from = Math.floor(theme.firstSeen / bucketMs) * bucketMs
  const [detail, rollup] = await Promise.all([
    themeDetail(d, id, {
      stories: DASHBOARD.entityPageStories,
      entities: DASHBOARD.signalEntities,
      rows: DASHBOARD.storyPageRows,
    }),
    rollupTotals(d, "theme", [String(id)], from, now, bucketMs),
  ])
  const buckets = bucketsBetween(from, now).filter((b) => b % bucketMs === 0)
  const got = new Map(rollup.map((r) => [r.bucket, r.articles]))
  const last = Math.max(1, buckets.length - 1)
  return {
    theme,
    spine: {
      title: `Articles per ${bucketMs === HOUR_MS ? "hour" : "day"}`,
      labels: buckets.map((b) => new Date(b).toISOString()),
      values: buckets.map((b) => got.get(b) ?? 0),
    },
    /** Each join with its place on the spine's x axis, 0 to 1. */
    joins: detail.joins.map((j) => ({
      ...j,
      x: Math.min(1, Math.max(0, (Math.floor(j.at / bucketMs) * bucketMs - from) / bucketMs / last)),
    })),
    stories: detail.stories.toReversed(),
    entities: detail.entities,
    events: detail.events,
  }
})

/** Runs a write as the signed-in user; a helper's Error becomes a form issue. */
const attempt = async (run: (by: string) => Promise<unknown>) => {
  try {
    await run(getRequestEvent().locals.user)
  } catch (e) {
    if (e instanceof Error) invalid(e.message)
    throw e
  }
}

/** A write, then the page refreshes. */
const write = async (id: number, run: (by: string) => Promise<unknown>) => {
  await attempt(run)
  await signalPage(id).refresh()
}

const subject = z.object({ id: positiveInt })

export const renameForm = form(
  subject.extend({
    name: z.string().trim().max(60).regex(THEME_NAME, "Two to four words, with no dashes or trailing full stop"),
  }),
  ({ id, name }) => write(id, (by) => renameTheme(db(), id, name, by)),
)

/** This theme goes into the one named, so the page moves there. */
export const mergeForm = form(subject.extend({ into: positiveInt }), async ({ id, into }) => {
  await attempt((by) => mergeThemeInto(db(), id, into, by))
  redirect(303, `/signals/${into}`)
})

export const closeForm = form(subject, ({ id }) => write(id, (by) => closeTheme(db(), id, by)))

export const detachForm = form(subject.extend({ story: positiveInt }), ({ id, story }) =>
  write(id, (by) => detachStoryTheme(db(), id, story, by)),
)
