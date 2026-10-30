import { DASHBOARD } from "@digest/core"
import { digestDay, digestEditions, sendStoryNow } from "@digest/db"
import { renderDigestHeader } from "@digest/telegram"
import { z } from "zod"
import { attempt } from "#lib/forms.ts"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { renderStory, telegram } from "#lib/server/telegram.ts"
import { form, query } from "$app/server"

const PAGE_DAYS = DASHBOARD.digestPageDays

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** One page of PAGE_DAYS UTC days of digest editions, newest first, page 1 ending with today. */
export const editionPage = query(z.number().int().positive(), async (page) => {
  const d = db()
  const to = Math.floor(Date.now() / DAY_MS) * DAY_MS + DAY_MS - (page - 1) * PAGE_DAYS * DAY_MS
  const from = isoDate(to - PAGE_DAYS * DAY_MS)
  const [rows, older] = await Promise.all([digestEditions(d, from, isoDate(to)), digestEditions(d, "", from, 1)])
  return { rows, more: older.length > 0 }
})

/** YYYY-MM-DD. */
const utcDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)))

/**
 * The edition of one UTC date, each item re-rendered from its stored story as the Digest workflow renders it, so in
 * Telegram HTML with the links picked from the story's current articles, and the alerts sent that day.
 */
export const edition = query(utcDate, async (date) => {
  const from = Date.parse(`${date}T00:00:00Z`)
  const rows = await digestDay(db(), date, from, from + DAY_MS)
  const items = rows.filter((r) => r.kind !== "alert")
  return {
    header: items.length ? renderDigestHeader(date, items.length) : null,
    items: await Promise.all(
      items.map(async (r) => ({ ...r, html: await renderStory({ ...r, id: r.storyId }, r.kind === "update") })),
    ),
    alerts: rows.filter((r) => r.kind === "alert"),
  }
})

/** Sends a story to every digest chat now, as an alert with the vote row. */
export const sendNowForm = form(z.object({ id: z.number().int().positive() }), ({ id }) =>
  attempt((by) => {
    const t = telegram()
    if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set, so nothing can be sent")
    return sendStoryNow(db(), t.bot, t.chatIds, id, by)
  }),
)
