import { bucketsBetween, DASHBOARD, ENTITIES, hourBucket, normaliseEntityKey } from "@digest/core"
import {
  entityById,
  entityByKey,
  entityDetail,
  mergeEntity,
  renameEntity,
  rollupSeries,
  storyThemeChips,
} from "@digest/db"
import { error, invalid, redirect } from "@sveltejs/kit"
import { z } from "zod"
import { entityHref } from "#lib/components/index.ts"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { form, getRequestEvent, query } from "$app/server"

const key = z.string().min(1)

/** Bucket starts with their counts, zero-filled, as chart labels and values. */
const line = (buckets: number[], got: Map<number, number>) => ({
  labels: buckets.map((b) => new Date(b).toISOString()),
  values: buckets.map((b) => got.get(b) ?? 0),
})

/**
 * The entity page in one round of reads after the entity row, then its stories' signals; a merged entity redirects to
 * the one it went into.
 */
export const entityPage = query(key, async (k) => {
  const d = db()
  const entity = await entityByKey(d, k)
  if (!entity) error(404, `No entity ${k}`)
  if (entity.mergedInto !== null) {
    const into = await entityById(d, entity.mergedInto)
    if (into) redirect(307, entityHref(into.key))
  }
  const now = Date.now()
  const from = Math.max(hourBucket(entity.firstSeen), hourBucket(now) - DASHBOARD.storyChartDays * DAY_MS)
  const dayFrom = Math.floor(from / DAY_MS) * DAY_MS
  const [detail, rollup] = await Promise.all([
    entityDetail(d, entity.id, { since: dayFrom, limit: DASHBOARD.entityPageStories }),
    rollupSeries(d, "entity", String(entity.id), from, now),
  ])
  const themes = await storyThemeChips(
    d,
    detail.stories.map((s) => s.id),
  )
  return {
    entity,
    aliases: detail.aliases,
    stories: detail.stories.map((s) => ({ ...s, themes: themes.get(s.id) ?? [] })),
    articlesPerHour: line(bucketsBetween(from, now), new Map(rollup.map((r) => [r.bucket, r.articles]))),
    storiesPerDay: line(
      bucketsBetween(dayFrom, now).filter((b) => b % DAY_MS === 0),
      new Map(detail.storiesPerDay.map((r) => [r.day, r.n])),
    ),
  }
})

/** Runs a write as the signed-in user; a helper's Error becomes a form issue, then the page refreshes. */
const write = async (k: string, run: (by: string) => Promise<unknown>) => {
  try {
    await run(getRequestEvent().locals.user)
  } catch (e) {
    if (e instanceof Error) invalid(e.message)
    throw e
  }
  await entityPage(k).refresh()
}

const subject = z.object({ id: z.number().int().positive(), key })

/** Folds another entity into this one; `alias` is its key, or a name that normalises to it. */
export const mergeForm = form(subject.extend({ alias: z.string().trim().min(1) }), ({ id, key: k, alias }) =>
  write(k, async (by) => {
    const d = db()
    const from = await entityByKey(d, normaliseEntityKey(alias, ENTITIES.suffixes))
    if (!from) throw new Error(`No entity has the key "${alias}"`)
    await mergeEntity(d, from.id, id, by)
  }),
)

export const renameForm = form(subject.extend({ name: z.string().trim().min(1).max(200) }), ({ id, key: k, name }) =>
  write(k, (by) => renameEntity(db(), id, name, by)),
)
