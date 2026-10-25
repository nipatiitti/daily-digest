import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { claimDigest, finishDigest, getDb, recordDelivery, setDeliveryMessageId } from "@digest/db"
import { feedbackKeyboard, parseChatIds, renderEmptyDigest } from "@digest/telegram"
import { Api } from "grammy"

export type DigestParams = {
  /** YYYY-MM-DD (UTC); the idempotency key. */
  date: string
}

const SEND = { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" } as const

/** Daily digest. The skeleton always sends "Nothing notable today". */
export class Digest extends WorkflowEntrypoint<Env, DigestParams> {
  override async run(event: WorkflowEvent<DigestParams>, step: WorkflowStep) {
    const { date } = event.payload
    const db = getDb(this.env.DB)

    const claimed = await step.do("claim", () => claimDigest(db, date))
    if (!claimed) return { skipped: "already claimed" }

    const api = new Api(this.env.TELEGRAM_BOT_TOKEN)
    const text = renderEmptyDigest(date)
    const chatIds = parseChatIds(this.env.TELEGRAM_CHAT_IDS)
    if (chatIds.length === 0) console.warn("TELEGRAM_CHAT_IDS is empty; nothing to send")

    let sent = 0
    for (const chatId of chatIds) {
      const deliveryId = await step.do(`record ${chatId}`, () =>
        recordDelivery(db, { kind: "digest", digestDate: date, chatId }),
      )
      try {
        await step.do(`send ${chatId}`, SEND, async () => {
          const msg = await api.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: feedbackKeyboard(deliveryId),
            link_preview_options: { is_disabled: true },
          })
          await setDeliveryMessageId(db, deliveryId, msg.message_id)
        })
        sent++
      } catch (e) {
        console.error(JSON.stringify({ event: "digest_send_failed", chatId, error: String(e) }))
      }
    }

    await step.do("finish", async () => {
      await finishDigest(db, date, sent > 0 ? "sent" : "failed", 0, Date.now())
    })
    return { sent }
  }
}
