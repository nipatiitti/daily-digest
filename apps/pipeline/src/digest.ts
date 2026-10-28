import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { DIGEST, fillSlots, MATCH, titleJaccard } from "@digest/core"
import {
  activeFactIds,
  changedStories,
  claimDigest,
  finishDigest,
  getDb,
  getStory,
  latestDeliveries,
  mainSources,
  mergeStories,
  previousDigestSentAt,
  recordDelivery,
  type StoryArticle,
  setDeliveryMessageId,
  storyArticles,
  updateGatePassedSince,
} from "@digest/db"
import { type Llm, LlmRefusal, SpendCapError, sameStory } from "@digest/llm"
import {
  type DigestItem,
  feedbackKeyboard,
  parseChatIds,
  renderDigestHeader,
  renderDigestItem,
  renderEmptyDigest,
} from "@digest/telegram"
import { Api } from "grammy"
import { llmFor } from "./llm.ts"

export type DigestParams = {
  /** YYYY-MM-DD (UTC); the idempotency key. */
  date: string
}

type Selected = { storyId: number; isUpdate: boolean; score: number }

type Candidate = {
  storyId: number
  topic: "security" | "tech" | "world"
  score: number
  fiRelevance: number
  primaryEntity: string | null
  mainSourceId: number
  isUpdate: boolean
}

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

/** Two stories look like one event when their titles overlap heavily or Haiku says so. */
const sameEventStories = async (db: ReturnType<typeof getDb>, llm: Llm | null, a: number, b: number) => {
  const [sa, sb] = await Promise.all([getStory(db, a), getStory(db, b)])
  if (!sa || !sb) return false
  if (titleJaccard(sa.title, sb.title) >= MATCH.copyTitleJaccard) return true
  if (!llm) return false
  const [la, lb] = await Promise.all([storyArticles(db, a), storyArticles(db, b)])
  try {
    return await sameStory(
      llm,
      { title: sa.title, articleTitles: la.slice(0, 5).map((x) => x.title) },
      { title: sb.title, articleTitles: lb.slice(0, 5).map((x) => x.title) },
      a,
    )
  } catch (e) {
    if (e instanceof SpendCapError || e instanceof LlmRefusal) {
      log("digest_dedupe_skipped", { a, b, error: String(e) })
      return false
    }
    throw e
  }
}

/**
 * Same-event stories that the matcher kept apart (typically one in Finnish, one in English) are
 * merged here before slotting: the lower-scored story folds into the higher one. Only the top
 * candidates within one topic group are compared, so the Haiku cost stays at a few cents.
 */
const dedupeCandidates = async (
  db: ReturnType<typeof getDb>,
  llm: Llm | null,
  candidates: Candidate[],
  now: number,
) => {
  const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, DIGEST.dedupeTop)
  const rest = candidates.filter((c) => !top.includes(c))
  const merged = new Set<number>()
  for (let i = 0; i < top.length; i++) {
    const keep = top[i]
    if (!keep || merged.has(keep.storyId)) continue
    for (let j = i + 1; j < top.length; j++) {
      const other = top[j]
      if (!other || merged.has(other.storyId)) continue
      if ((keep.topic === "world") !== (other.topic === "world")) continue
      if (!(await sameEventStories(db, llm, keep.storyId, other.storyId))) continue
      await mergeStories(db, other.storyId, keep.storyId, now)
      merged.add(other.storyId)
      keep.fiRelevance = Math.max(keep.fiRelevance, other.fiRelevance)
      keep.isUpdate = keep.isUpdate || other.isUpdate
      log("digest_merged", { from: other.storyId, into: keep.storyId })
    }
  }
  return [...top.filter((c) => !merged.has(c.storyId)), ...rest]
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
    const llm = llmFor(this.env, db)

    const claimed = await step.do("claim", () => claimDigest(db, date))
    if (!claimed) return { skipped: "already claimed" }

    const selected = await step.do("select", async (): Promise<Selected[]> => {
      const now = Date.now()
      const since = (await previousDigestSentAt(db)) ?? now - DIGEST.windowHours * HOUR
      const changed = await changedStories(db, since)
      const ids = changed.map((s) => s.id)
      const [delivered, sources] = await Promise.all([latestDeliveries(db, ids), mainSources(db, ids)])
      const candidates: Candidate[] = []
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
      const deduped = await dedupeCandidates(db, llm, candidates, now)
      const picked = fillSlots(deduped).map((c) => ({ storyId: c.storyId, isUpdate: c.isUpdate, score: c.score }))
      log("digest_selected", {
        date,
        candidates: candidates.length,
        merged: candidates.length - deduped.length,
        picked: picked.map((p) => p.storyId),
      })
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
            origins: story.independentOrigins,
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
