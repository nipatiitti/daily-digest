import { DAY_MS, EDITION_LABEL, parseEditionKey, STATUS } from "@digest/core"
import { digestDay, digestEditions, SHADOW_MODES } from "@digest/db"
import { renderDigestHeader, renderEmptyDigest } from "@digest/telegram"
import { error } from "@sveltejs/kit"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

const PAGE_DAYS = STATUS.digestPageDays

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * One page of PAGE_DAYS UTC days of v2 digest editions, newest first, page 1 ending with today. Each row is one
 * edition, keyed as the database stores it, with its UTC date, its label, what went out and the shadow modes written
 * for it.
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
 * One edition as sent, each event with its copy, beside what the v2 edition would have sent for it in each shadow
 * mode, as the Telegram HTML stored with each shadow item. The morning edition also lists the alerts sent that UTC
 * day, so they show once per day. A key that is not a v2 edition is not found.
 */
export const edition = query(editionKeyParam, async (key) => {
  const parsed = parseEditionKey(key)
  if (!parsed) error(400, `Not an edition: ${key}`)
  const from = Date.parse(`${parsed.date}T00:00:00Z`)
  const { v2, sent, shadow } = await digestDay(db(), key, from, from + DAY_MS)
  if (!v2) error(404, `No edition sent for ${key}`)
  const events = sent.filter((r) => r.kind !== "alert")
  return {
    date: parsed.date,
    label: EDITION_LABEL[parsed.edition],
    header: events.length ? renderDigestHeader(key, events.length) : renderEmptyDigest(key),
    events,
    shadow: SHADOW_MODES.map((mode) => ({ mode, items: shadow.filter((r) => r.mode === mode) })).filter(
      (m) => m.items.length,
    ),
    alerts: parsed.edition === "morning" ? sent.filter((r) => r.kind === "alert") : null,
  }
})
