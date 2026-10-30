import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { DIGEST, type Edition, editionKey, fillSlots, MATCH, titleJaccard } from "@digest/core"
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
  setDeliveryMessageId,
  storyArticles,
} from "@digest/db"
import { type Llm, LlmRefusal, SpendCapError, sameStory } from "@digest/llm"
import {
  feedbackKeyboard,
  parseChatIds,
  renderDigestHeader,
  renderDigestItem,
  renderEmptyDigest,
  storyItem,
} from "@digest/telegram"
import { Api } from "grammy"
import { llmFor } from "./llm.ts"

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

/** A story that changed since the previous edition but was already delivered, so it is never sent again. */
type Delivered = { storyId: number; topic: Topic; score: number }

const SEND = { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" } as const
const HOUR = 3_600_000

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))
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

/** World stories are only compared with world stories, and security and tech with each other. */
const sameGroup = (a: Topic, b: Topic) => (a === "world") === (b === "world")

/**
 * A candidate that is the same event as a story already delivered folds into that story and is dropped, so a second
 * story about something the reader already got never goes out as new. The top candidates are checked against the top
 * delivered stories that changed since the previous edition.
 */
const dropDelivered = async (
  db: ReturnType<typeof getDb>,
  llm: Llm | null,
  candidates: Candidate[],
  delivered: Delivered[],
  now: number,
) => {
  const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, DIGEST.dedupeTop)
  const against = [...delivered].sort((a, b) => b.score - a.score).slice(0, DIGEST.dedupeTop)
  const merged = new Set<number>()
  for (const c of top) {
    for (const d of against) {
      if (!sameGroup(c.topic, d.topic)) continue
      if (!(await sameEventStories(db, llm, c.storyId, d.storyId))) continue
      await mergeStories(db, c.storyId, d.storyId, now)
      merged.add(c.storyId)
      log("digest_merged_into_delivered", { from: c.storyId, into: d.storyId })
      break
    }
  }
  return candidates.filter((c) => !merged.has(c.storyId))
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
      if (!sameGroup(keep.topic, other.topic)) continue
      if (!(await sameEventStories(db, llm, keep.storyId, other.storyId))) continue
      await mergeStories(db, other.storyId, keep.storyId, now)
      merged.add(other.storyId)
      keep.fiRelevance = Math.max(keep.fiRelevance, other.fiRelevance)
      log("digest_merged", { from: other.storyId, into: keep.storyId })
    }
  }
  return [...top.filter((c) => !merged.has(c.storyId)), ...rest]
}

/**
 * Digest, a morning and an afternoon edition: candidates are scored stories that changed since the previous edition
 * and were never delivered. A delivered story is never sent again, and a candidate that is the same event as one is
 * merged into it. Slots are filled in code, one Telegram message per item, each with its own delivery row and vote
 * buttons.
 */
export class Digest extends WorkflowEntrypoint<Env, DigestParams> {
  override async run(event: WorkflowEvent<DigestParams>, step: WorkflowStep) {
    // Instances created before editions carry only the date, and those were morning digests.
    const { date, edition = "morning" } = event.payload
    const key = editionKey(date, edition)
    const db = getDb(this.env.DB)
    const llm = llmFor(this.env, db)

    const claimed = await step.do("claim", () => claimDigest(db, key))
    if (!claimed) return { skipped: "already claimed" }

    const selected = await step.do("select", async (): Promise<Selected[]> => {
      const now = Date.now()
      const since = (await previousDigestSentAt(db)) ?? now - DIGEST.windowHours * HOUR
      const changed = await changedStories(db, since)
      const ids = changed.map((s) => s.id)
      const [prior, sources] = await Promise.all([latestDeliveries(db, ids), mainSources(db, ids)])
      const candidates: Candidate[] = []
      const delivered: Delivered[] = []
      for (const s of changed) {
        if (s.score === null || s.category === "fi") continue
        if (prior.has(s.id)) {
          delivered.push({ storyId: s.id, topic: s.category, score: s.score })
          continue
        }
        candidates.push({
          storyId: s.id,
          topic: s.category,
          score: s.score,
          fiRelevance: s.fiRelevance,
          primaryEntity: s.primaryEntity,
          mainSourceId: sources.get(s.id) ?? 0,
        })
      }
      const fresh = await dropDelivered(db, llm, candidates, delivered, now)
      const deduped = await dedupeCandidates(db, llm, fresh, now)
      const picked = fillSlots(deduped).map((c) => ({ storyId: c.storyId, score: c.score }))
      log("digest_selected", {
        date,
        edition,
        candidates: candidates.length,
        mergedIntoDelivered: candidates.length - fresh.length,
        merged: fresh.length - deduped.length,
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
