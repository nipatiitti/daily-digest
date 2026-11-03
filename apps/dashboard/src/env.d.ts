// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
declare namespace Cloudflare {
  interface Env {
    /** Unset until added as a build variable; the on-demand answers return 503 without it. */
    ANTHROPIC_API_KEY?: string
  }
}
