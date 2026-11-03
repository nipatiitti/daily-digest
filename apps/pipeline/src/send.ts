import type { WorkflowStep } from "cloudflare:workers"
import { type Db, recordDelivery, setDeliveryMessageId } from "@digest/db"
import { feedbackKeyboard } from "@digest/telegram"
import type { Api } from "grammy"

/** Runs one named unit: a workflow step (`retried` for the Telegram call), or the plain call outside a workflow. */
export type Run = (name: string, fn: () => Promise<number>, retried?: boolean) => Promise<number>

const SEND = { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" } as const

export const inSteps =
  (step: WorkflowStep): Run =>
  (name, fn, retried) =>
    retried ? step.do(name, SEND, fn) : step.do(name, fn)

export const directly: Run = (_name, fn) => fn()

/**
 * Records the delivery, sends it and stores its message id, each its own unit, so a retried send never records the
 * delivery twice and storing the id never sends again. A delivery with an event gets vote buttons, and a silent one
 * no notification. A failed send is logged and returns false.
 */
export const sendDelivery = async (
  run: Run,
  api: Api,
  db: Db,
  name: string,
  text: string,
  delivery: Parameters<typeof recordDelivery>[1],
) => {
  const { chatId } = delivery
  const deliveryId = await run(`record ${name} ${chatId}`, () => recordDelivery(db, delivery))
  let messageId: number
  try {
    messageId = await run(
      `send ${name} ${chatId}`,
      async () =>
        (
          await api.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: delivery.eventId ? feedbackKeyboard(deliveryId) : undefined,
            link_preview_options: { is_disabled: true },
            disable_notification: delivery.silent ?? false,
          })
        ).message_id,
      true,
    )
  } catch (e) {
    console.error(JSON.stringify({ event: `${delivery.kind}_send_failed`, chatId, name, error: String(e) }))
    return false
  }
  await run(`store ${name} ${chatId}`, async () => {
    await setDeliveryMessageId(db, deliveryId, messageId)
    return messageId
  })
  return true
}
