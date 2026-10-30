import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { DIGEST, type Edition, editionKey, fillSlots } from "@digest/core"
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
  setDeliveryMessageId,
  storyArticles,
} from "@digest/db"
import {
  feedbackKeyboard,
  parseChatIds,
  renderDigestHeader,
  renderDigestItem,
  renderEmptyDigest,
  storyItem,
} from "@digest/telegram"
import { Api } from "grammy"

export type DigestParams = {
  /** YYYY-MM-DD (UTC); with the edition it makes the idempotency key (editionKey). */
  date: string
  edition: Edition
}

type Selected = { storyId: number; score: number }

type Topic = "security" | "tech" | "world"

type Candidate = {
  storyId: number
  topic: Topic
  score: number
  fiRelevance: number
  primaryEntity: string | null
  mainSourceId: number
}

const SEND = { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" } as const
const HOUR = 3_600_000

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

/**
 * Digest, a morning and an afternoon edition: candidates are scored stories that changed since the previous edition
 * and were never delivered, so a delivered story is never sent again. Same-event stories are merged before this by
 * the matcher and the hourly merge pass, and a merge carries deliveries to the surviving story. Slots are filled in
 * code, one Telegram message per item, each with its own delivery row and vote buttons.
 */
export class Digest extends WorkflowEntrypoint<Env, DigestParams> {
  override async run(event: WorkflowEvent<DigestParams>, step: WorkflowStep) {
    // Instances created before editions carry only the date, and those were morning digests.
    const { date, edition = "morning" } = event.payload
    const key = editionKey(date, edition)
    const db = getDb(this.env.DB)

    const claimed = await step.do("claim", () => claimDigest(db, key))
    if (!claimed) return { skipped: "already claimed" }

    const selected = await step.do("select", async (): Promise<Selected[]> => {
      const now = Date.now()
      const since = (await previousDigestSentAt(db)) ?? now - DIGEST.windowHours * HOUR
      const changed = await changedStories(db, since)
      const ids = changed.map((s) => s.id)
      const [prior, sources] = await Promise.all([latestDeliveries(db, ids), mainSources(db, ids)])
      const candidates: Candidate[] = []
      for (const s of changed) {
        if (s.score === null || s.category === "fi" || prior.has(s.id)) continue
        candidates.push({
          storyId: s.id,
          topic: s.category,
          score: s.score,
          fiRelevance: s.fiRelevance,
          primaryEntity: s.primaryEntity,
          mainSourceId: sources.get(s.id) ?? 0,
        })
      }
      const picked = fillSlots(candidates).map((c) => ({ storyId: c.storyId, score: c.score }))
      log("digest_selected", { date, edition, candidates: candidates.length, picked: picked.map((p) => p.storyId) })
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
      const text = renderEmptyDigest(key)
      for (const chatId of chatIds) {
        if (await send(chatId, "empty", text, { kind: "digest", digestDate: key, chatId })) sent++
      }
    } else {
      const items = await step.do("render", async () => {
        const out: { storyId: number; score: number; origins: number; text: string; factIds: number[] }[] = []
        for (const s of selected) {
          const story = await getStory(db, s.storyId)
          if (!story) continue
          out.push({
            ...s,
            origins: story.independentOrigins,
            text: renderDigestItem(storyItem(story, await storyArticles(db, s.storyId), false)),
            factIds: await activeFactIds(db, s.storyId),
          })
        }
        return out
      })
      for (const chatId of chatIds) {
        await send(chatId, "header", renderDigestHeader(key, items.length), {
          kind: "digest",
          digestDate: key,
          chatId,
        })
        for (const item of items) {
          const ok = await send(chatId, `story ${item.storyId}`, item.text, {
            kind: "digest",
            digestDate: key,
            chatId,
            storyId: item.storyId,
            scoreAtSend: item.score,
            originsAtSend: item.origins,
            factIdsJson: item.factIds,
          })
          if (ok) sent++
        }
      }
    }

    await step.do("finish", async () => {
      await finishDigest(db, key, sent > 0 || chatIds.length === 0 ? "sent" : "failed", selected.length, Date.now())
    })
    return { sent, items: selected.length }
  }
}
