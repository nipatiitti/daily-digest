import { DASHBOARD, HOUR_MS } from "@digest/core"
import { rankedStories, storyThemeChips } from "@digest/db"
import { z } from "zod"
import { DAY_MS, RANGES, rangeToWindow } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

const input = z.object({
  range: z.enum(RANGES),
  /** Bucket starts in unix ms, as the front page chart links them. */
  hour: z.coerce.number().int().optional(),
  day: z.coerce.number().int().optional(),
  q: z.string().trim().optional(),
})

/**
 * Stories by score in the range, or with an article in one hour or day bucket, optionally matching a title search,
 * each with its signals.
 */
export const storyList = query(input, async ({ range, hour, day, q }) => {
  const d = db()
  const at = hour ?? day
  const stories = await rankedStories(d, {
    from: rangeToWindow(range, Date.now()).from,
    limit: DASHBOARD.storiesPageSize,
    bucket: at === undefined ? undefined : { from: at, to: at + (hour === undefined ? DAY_MS : HOUR_MS) },
    q,
  })
  const themes = await storyThemeChips(
    d,
    stories.map((s) => s.id),
  )
  return stories.map((s) => ({ ...s, themes: themes.get(s.id) ?? [] }))
})
