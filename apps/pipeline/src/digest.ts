import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { DIGEST, fillSlots } from "@digest/core"
import {
  activeFactIds,
  changedStories,
  claimDigest,
  finishDigest,
  getDb,
  getStory,
  latestDeliveries,
  mainSources,
  previousDigestSentAt,
  recordDelivery,
  type StoryArticle,
  setDeliveryMessageId,
  storyArticles,
  updateGatePassedSince,
} from "@digest/db"
import {
  type DigestItem,
  feedbackKeyboard,
  parseChatIds,
  renderDigestHeader,
  renderDigestItem,
  renderEmptyDigest,
} from "@digest/telegram"
import { Api } from "grammy"

export type DigestParams = {
  /** YYYY-MM-DD (UTC); the idempotency key. */
  date: string
}

type Selected = { storyId: number; isUpdate: boolean; score: number }

const SEND = { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" } as const
const HOUR = 3_600_000
const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

/** Links chosen by code: origins only, authoritative first, one per domain, at most three. */
const pickLinks = (list: StoryArticle[]) => {
  const seen = new Set<string>()
  return [...list]
    .filter((a) => a.originId === null)
    .sort(
      (a, b) =>
        Number(b.authoritative) - Number(a.authoritative) ||
        (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) ||
        a.publishedAt - b.publishedAt,
    )
    .filter((a) => {
      if (seen.has(a.domain)) return false
      seen.add(a.domain)
      return true
    })
    .slice(0, DIGEST.maxLinks)
    .map((a) => ({ url: a.canonicalUrl, label: a.sourceName }))
}

/**
 * Daily digest: candidates are scored stories that changed since the previous digest and were
 * not delivered, or were delivered and have since passed the update gate. Slots are filled in
 * code, one Telegram message per item, each with its own delivery row and vote buttons.
 */
export class Digest extends WorkflowEntrypoint<Env, DigestParams> {
  override async run(event: WorkflowEvent<DigestParams>, step: WorkflowStep) {
    const { date } = event.payload
    const db = getDb(this.env.DB)

    const claimed = await step.do("claim", () => claimDigest(db, date))
    if (!claimed) return { skipped: "already claimed" }

    const selected = await step.do("select", async (): Promise<Selected[]> => {
      const now = Date.now()
      const since = (await previousDigestSentAt(db)) ?? now - DIGEST.windowHours * HOUR
      const changed = await changedStories(db, since)
      const ids = changed.map((s) => s.id)
      const [delivered, sources] = await Promise.all([latestDeliveries(db, ids), mainSources(db, ids)])
      const candidates = []
      for (const s of changed) {
        if (s.score === null || s.category === "fi") continue
        const d = delivered.get(s.id)
        let isUpdate = false
        if (d) {
          if (!(await updateGatePassedSince(db, s.id, d.sentAt))) continue
          isUpdate = true
        }
        candidates.push({
          storyId: s.id,
          topic: s.category,
          score: s.score,
          fiRelevance: s.fiRelevance,
          primaryEntity: s.primaryEntity,
          mainSourceId: sources.get(s.id) ?? 0,
          isUpdate,
        })
      }
      const picked = fillSlots(candidates).map((c) => ({ storyId: c.storyId, isUpdate: c.isUpdate, score: c.score }))
      log("digest_selected", { date, candidates: candidates.length, picked: picked.map((p) => p.storyId) })
      return picked
    })

    const api = new Api(this.env.TELEGRAM_BOT_TOKEN)
    const chatIds = parseChatIds(this.env.TELEGRAM_CHAT_IDS)
    if (chatIds.length === 0) console.warn("TELEGRAM_CHAT_IDS is empty; nothing to send")

    const send = async (chatId: number, name: string, text: string, delivery: Parameters<typeof recordDelivery>[1]) => {
      const deliveryId = await step.do(`record ${name} ${chatId}`, () => recordDelivery(db, delivery))
      try {
        await step.do(`send ${name} ${chatId}`, SEND, async () => {
          const msg = await api.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: delivery.storyId === null ? undefined : feedbackKeyboard(deliveryId),
            link_preview_options: { is_disabled: true },
          })
          await setDeliveryMessageId(db, deliveryId, msg.message_id)
        })
        return true
      } catch (e) {
        console.error(JSON.stringify({ event: "digest_send_failed", chatId, name, error: String(e) }))
        return false
      }
    }

    let sent = 0
    if (selected.length === 0) {
      const text = renderEmptyDigest(date)
      for (const chatId of chatIds) {
        if (await send(chatId, "empty", text, { kind: "digest", digestDate: date, chatId })) sent++
      }
    } else {
      const items = await step.do("render", async () => {
        const out: { storyId: number; isUpdate: boolean; score: number; text: string; factIds: number[] }[] = []
        for (const s of selected) {
          const story = await getStory(db, s.storyId)
          if (!story) continue
          const list = await storyArticles(db, s.storyId)
          const item: DigestItem = {
            topic: story.category,
            fiRelevance: story.fiRelevance,
            headline: story.title,
            summary: story.summary ?? "",
            whyMatters: story.whyMatters ?? "",
            origins: story.independentOrigins,
            authoritative: [...new Set(list.filter((a) => a.authoritative).map((a) => a.sourceName))],
            links: pickLinks(list),
            isUpdate: s.isUpdate,
          }
          out.push({ ...s, text: renderDigestItem(item), factIds: await activeFactIds(db, s.storyId) })
        }
        return out
      })
      for (const chatId of chatIds) {
        await send(chatId, "header", renderDigestHeader(date, items.length), {
          kind: "digest",
          digestDate: date,
          chatId,
        })
        for (const item of items) {
          const ok = await send(chatId, `story ${item.storyId}`, item.text, {
            kind: item.isUpdate ? "update" : "digest",
            digestDate: date,
            chatId,
            storyId: item.storyId,
            scoreAtSend: item.score,
            factIdsJson: item.factIds,
          })
          if (ok) sent++
        }
      }
    }

    await step.do("finish", async () => {
      await finishDigest(db, date, sent > 0 || chatIds.length === 0 ? "sent" : "failed", selected.length, Date.now())
    })
    return { sent, items: selected.length }
  }
}
