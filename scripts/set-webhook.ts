// Points the Telegram bot at the ingress Worker. Safe to run on every deploy.
//   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… node scripts/set-webhook.ts
const WEBHOOK_URL = "https://hooks.dd.nipatiitti.fi/telegram"

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!token || !secret) {
  console.warn("set-webhook: TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET not set, skipped")
  process.exit(0)
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: WEBHOOK_URL,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  }),
})
const body = (await res.json()) as { ok: boolean; description?: string }
if (!body.ok) {
  console.error(`set-webhook: ${body.description ?? res.status}`)
  process.exit(1)
}
console.log(`set-webhook: ${WEBHOOK_URL}`)
