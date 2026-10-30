import { DASHBOARD, EDITION_LABEL, parseEditionKey } from "@digest/core"
import { digestDay, digestEditions, sendStoryNow } from "@digest/db"
import { renderDigestHeader } from "@digest/telegram"
import { error } from "@sveltejs/kit"
import { z } from "zod"
import { attempt } from "#lib/forms.ts"
import { DAY_MS } from "#lib/range.ts"
import { db } from "#lib/server/db.ts"
import { renderStory, telegram } from "#lib/server/telegram.ts"
import { form, query } from "$app/server"

const PAGE_DAYS = DASHBOARD.digestPageDays

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * One page of PAGE_DAYS UTC days of digest editions, newest first, page 1 ending with today. Each row is one edition,
 * keyed as the database stores it, with its UTC date and its label.
 */
export const editionPage = query(z.number().int().positive(), async (page) => {
  const d = db()
  const to = Math.floor(Date.now() / DAY_MS) * DAY_MS + DAY_MS - (page - 1) * PAGE_DAYS * DAY_MS
  const from = isoDate(to - PAGE_DAYS * DAY_MS)
  const [rows, older] = await Promise.all([digestEditions(d, from, isoDate(to)), digestEditions(d, "", from, 1)])
  return {
    rows: rows.map((r) => {
      const parsed = parseEditionKey(r.key)
      return { ...r, date: parsed?.date ?? r.key, label: parsed ? EDITION_LABEL[parsed.edition] : null }
    }),
    more: older.length > 0,
  }
})

/** An edition key (editionKey): YYYY-MM-DD for the morning edition, YYYY-MM-DD-afternoon for the afternoon one. */
const editionKeyParam = z.string().refine((s) => {
  const parsed = parseEditionKey(s)
  return parsed !== null && !Number.isNaN(Date.parse(parsed.date))
})

/**
 * One edition, each item re-rendered from its stored story as the Digest workflow renders it, so in Telegram HTML with
 * the links picked from the story's current articles. The morning edition also lists the alerts sent that UTC day,
 * so they show once per day.
 */
export const edition = query(editionKeyParam, async (key) => {
  const parsed = parseEditionKey(key)
  if (!parsed) error(400, `Not an edition: ${key}`)
  const from = Date.parse(`${parsed.date}T00:00:00Z`)
  const rows = await digestDay(db(), key, from, from + DAY_MS)
  const items = rows.filter((r) => r.kind !== "alert")
  const morning = parsed.edition === "morning"
  return {
    date: parsed.date,
    label: EDITION_LABEL[parsed.edition],
    header: items.length ? renderDigestHeader(key, items.length) : null,
    items: await Promise.all(
      items.map(async (r) => ({ ...r, html: await renderStory({ ...r, id: r.storyId }, r.kind === "update") })),
    ),
    alerts: morning ? rows.filter((r) => r.kind === "alert") : null,
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
