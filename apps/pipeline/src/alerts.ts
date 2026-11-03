import { ALERTS, DAY_MS, EDITION, HOUR_MS, sanitizeUserText } from "@digest/core"
import { alertDeliveries, currentProfile, type Db, eventMembers, followedLinks } from "@digest/db"
import type { Llm } from "@digest/llm"
import { escapeHtml, parseChatIds } from "@digest/telegram"
import { Api } from "grammy"
import { buildEventItems } from "./items.ts"
import { directly, sendDelivery } from "./send.ts"
import { log } from "./util.ts"

const helsinkiHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "numeric",
  hourCycle: "h23",
})

const isQuiet = (now: number) => {
  const h = Number(helsinkiHour.format(now))
  const { start, end } = ALERTS.quietHours
  return start > end ? h >= start || h < end : h >= start && h < end
}

/**
 * Hourly, once EDITION.mode is "send": an active event on a followed thread or entity with an article in the last
 * ALERTS.lookbackHours gets one message outside the editions when an official source reports it or enough origins
 * were published in the last hour. Never the same event twice, never a thread or entity again within the cooldown,
 * at most ALERTS.maxPerDay a UTC day, silent in the Helsinki quiet hours.
 */
export const alertsStep = async (
  env: { TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_IDS: string },
  db: Db,
  llm: Llm | null,
  now: number,
): Promise<Record<string, number>> => {
  if (EDITION.mode !== "send") return { shadow: 1 }
  const chatIds = parseChatIds(env.TELEGRAM_CHAT_IDS)
  if (!env.TELEGRAM_BOT_TOKEN || chatIds.length === 0) {
    log("alerts_skipped", { reason: "no bot token or chats" })
    return { skipped: 1 }
  }
  const current = await currentProfile(db)
  if (!current) return { skipped: 1 }
  const { follows } = current.profile
  const links = await followedLinks(db, follows, { since: now - ALERTS.lookbackHours * HOUR_MS })
  const eventIds = [...new Set(links.toSorted((a, b) => b.lastArticleAt - a.lastArticleAt).map((l) => l.eventId))]
  if (eventIds.length === 0) return { candidates: 0 }

  const dayStart = now - (now % DAY_MS)
  const coolFrom = now - ALERTS.cooldownHours * HOUR_MS
  const [members, sent] = await Promise.all([
    eventMembers(db, eventIds, now),
    alertDeliveries(db, Math.min(dayStart, coolFrom), eventIds),
  ])
  const alerted = new Set(sent.map((s) => s.eventId))
  const sentToday = new Set(sent.filter((s) => s.sentAt >= dayStart).map((s) => s.eventId)).size
  const key = (l: { kind: string; id: number }) => `${l.kind}:${l.id}`
  const recent = sent.filter((s) => s.sentAt >= coolFrom).flatMap((s) => s.eventId ?? [])
  const cooled = new Set((await followedLinks(db, follows, { eventIds: recent })).map(key))
  const qualifies = (id: number) => {
    const own = members.filter((m) => m.eventId === id)
    const origins1h = own.filter((m) => m.originArticleId === null && m.publishedAt >= now - HOUR_MS).length
    return own.some((m) => m.sourceRole === "official") || origins1h >= ALERTS.minOrigins1h
  }

  const picks: { eventId: number; reason: string }[] = []
  for (const id of eventIds) {
    if (sentToday + picks.length >= ALERTS.maxPerDay) break
    const own = links.filter((l) => l.eventId === id)
    if (alerted.has(id) || own.some((l) => cooled.has(key(l))) || !qualifies(id)) continue
    for (const l of own) cooled.add(key(l))
    picks.push({ eventId: id, reason: own[0]?.name ?? "" })
  }
  const silent = isQuiet(now)
  const counts = { candidates: eventIds.length, alerts: picks.length, sent: 0, silent: silent ? 1 : 0 }
  if (picks.length === 0) return counts

  const ids = picks.map((p) => p.eventId)
  const items = await buildEventItems(db, llm, current.profile, ids, now, { persist: true })
  const api = new Api(env.TELEGRAM_BOT_TOKEN)
  for (const { eventId, reason } of picks) {
    const item = items.get(eventId)
    if (!item) continue
    const text = `<b>Alert: ${escapeHtml(sanitizeUserText(reason))}</b>\n${item.text}`
    for (const chatId of chatIds) {
      const delivery = { eventId, threadId: item.threadId, chatId, originsAtSend: item.origins, silent }
      if (await sendDelivery(directly, api, db, `alert ${eventId}`, text, { kind: "alert", ...delivery })) counts.sent++
    }
  }
  return counts
}
