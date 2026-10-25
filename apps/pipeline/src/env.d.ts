// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  TELEGRAM_BOT_TOKEN: string
}
