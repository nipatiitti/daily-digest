# daily-digest

Single-user news pipeline on Cloudflare Workers: collects security, tech/AI and world news,
groups articles into stories, scores them, and sends a daily Telegram digest plus rare
breaking alerts. A private SvelteKit dashboard holds the longer write-ups.

See [PLAN.md](PLAN.md) for the layout, bindings and order of work.

```sh
pnpm install
pnpm check   # Biome + typecheck
```
