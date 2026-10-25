// Points the Telegram bot at the ingress Worker. Safe to run on every deploy.
//   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… node scripts/set-webhook.ts
const WEBHOOK_URL = "https://hooks.dd.nipatiitti.fi/telegram"

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!token || !secret) {
  console.warn("set-webhook: TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET not set, skipped")
  process.exit(0)
}

// A new custom domain takes a few minutes to get DNS and a certificate, and Telegram checks both.
const ATTEMPTS = 10
const DELAY_MS = 30_000

const setWebhook = async () => {
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
  return body.ok ? null : (body.description ?? `HTTP ${res.status}`)
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const error = await setWebhook()
  if (!error) {
    console.log(`set-webhook: ${WEBHOOK_URL}`)
    process.exit(0)
  }
  console.warn(`set-webhook: attempt ${attempt}/${ATTEMPTS}: ${error}`)
  if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, DELAY_MS))
}
console.error("set-webhook: gave up; the Worker is deployed, re-run the build once the domain serves HTTPS")
process.exit(1)
