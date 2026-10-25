import { getDb } from "@digest/db"
import { webhookCallback } from "grammy"
import { createBot } from "./bot.ts"

const WEBHOOK_PATH = "/telegram"

// Built once per isolate; bot.init() (getMe) then runs once instead of on every update.
let handle: ((req: Request) => Promise<Response>) | undefined

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (req.method !== "POST" || url.pathname !== WEBHOOK_PATH) return new Response("Not found", { status: 404 })
    handle ??= webhookCallback(createBot(env, getDb(env.DB)), "cloudflare-mod", {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
    })
    return handle(req)
  },
} satisfies ExportedHandler<Env>
