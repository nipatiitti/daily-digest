// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  TELEGRAM_BOT_TOKEN: string
  /** Unset until added as a build variable; LLM steps are skipped without it. */
  ANTHROPIC_API_KEY?: string
  /** Optional AI Gateway (or other proxy) base URL for the Anthropic API. */
  ANTHROPIC_BASE_URL?: string
}
