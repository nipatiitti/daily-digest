import { ALERT, DASHBOARD } from "@digest/core"
import { articleDetail, type Db, matchLogFor, moveArticle, newStoryFromArticle, refreshStoryCounters } from "@digest/db"
import { error, invalid, redirect } from "@sveltejs/kit"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { form, getRequestEvent, query } from "$app/server"

const positiveInt = z.number().int().positive()

export const articlePage = query(positiveInt, async (id) => {
  const d = db()
  const [article, matches] = await Promise.all([
    articleDetail(d, id),
    matchLogFor(d, id).limit(DASHBOARD.storyPageRows),
  ])
  if (!article) error(404, `No article ${id}`)
  return { article, matches }
})

/** Runs a write as the signed-in user, turning a helper's Error into a form issue. */
const attempt = async <T>(run: (by: string) => Promise<T>) => {
  try {
    return await run(getRequestEvent().locals.user)
  } catch (e) {
    if (e instanceof Error) invalid(e.message)
    throw e
  }
}

/** Counters on the story the article left and the one it joined, as the process stage writes them. */
const refreshCounters = (d: Db, storyIds: (number | null)[]) => {
  const now = Date.now()
  const opts = { velocityWindowMinutes: ALERT.worldVelocityWindowMinutes }
  return Promise.all(storyIds.flatMap((id) => (id === null ? [] : [refreshStoryCounters(d, id, now, opts)])))
}

export const moveForm = form(z.object({ id: positiveInt, into: positiveInt }), async ({ id, into }) => {
  const d = db()
  const from = await attempt((by) => moveArticle(d, id, into, by))
  await refreshCounters(d, [from, into])
  await articlePage(id).refresh()
})

export const newStoryForm = form(z.object({ id: positiveInt }), async ({ id }) => {
  const d = db()
  const { storyId, from } = await attempt((by) => newStoryFromArticle(d, id, by))
  await refreshCounters(d, [from, storyId])
  redirect(303, `/stories/${storyId}`)
})
