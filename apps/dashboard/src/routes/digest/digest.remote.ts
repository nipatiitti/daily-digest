import { DAY_MS, EDITION_LABEL, parseEditionKey, STATUS } from "@digest/core"
import { digestDay, digestEditions, SHADOW_MODES } from "@digest/db"
import { renderDigestHeader } from "@digest/telegram"
import { error } from "@sveltejs/kit"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { renderStory } from "#lib/server/telegram.ts"
import { query } from "$app/server"

const PAGE_DAYS = STATUS.digestPageDays

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * One page of PAGE_DAYS UTC days of digest editions, newest first, page 1 ending with today. Each row is one edition,
 * keyed as the database stores it, with its UTC date, its label, what went out and the shadow modes written for it.
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
 * One edition as sent, beside what the v2 edition would have sent for it in each shadow mode. A v1 item is re-rendered
 * from its stored story as the Digest workflow renders it, so in Telegram HTML with the links picked from the story's
 * current articles; a v2 item shows its event's copy; a shadow item is the Telegram HTML stored with it. The morning
 * edition also lists the alerts sent that UTC day, so they show once per day.
 */
export const edition = query(editionKeyParam, async (key) => {
  const parsed = parseEditionKey(key)
  if (!parsed) error(400, `Not an edition: ${key}`)
  const from = Date.parse(`${parsed.date}T00:00:00Z`)
  const { v1, v2, shadow } = await digestDay(db(), key, from, from + DAY_MS)
  const stories = v1.filter((r) => r.kind !== "alert")
  const events = v2.filter((r) => r.kind !== "alert")
  const count = stories.length + events.length
  const alerts = [
    ...v1.map((r) => ({ ...r, key: `s${r.storyId}`, eventId: null, headline: r.title })),
    ...v2.map((r) => ({ ...r, key: `e${r.eventId}`, scoreAtSend: null })),
  ]
    .filter((r) => r.kind === "alert")
    .toSorted((a, b) => a.sentAt - b.sentAt)
  return {
    date: parsed.date,
    label: EDITION_LABEL[parsed.edition],
    header: count ? renderDigestHeader(key, count) : null,
    stories: await Promise.all(
      stories.map(async (r) => ({ ...r, html: await renderStory({ ...r, id: r.storyId }, r.kind === "update") })),
    ),
    events,
    shadow: SHADOW_MODES.map((mode) => ({ mode, items: shadow.filter((r) => r.mode === mode) })).filter(
      (m) => m.items.length,
    ),
    alerts: parsed.edition === "morning" ? alerts : null,
  }
})
