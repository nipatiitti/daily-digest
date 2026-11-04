# daily-digest

Single-user news and trend platform on Cloudflare Workers. It polls about 70 feeds, gives every article an English
gist and facets, clusters articles into events and events into threads, scores each event against an editable
interest profile, and sends two Telegram editions a day. A private SvelteKit dashboard tracks threads, entities and
countries over time, and holds the profile and a status page.

Also has an Claude integration to ask info about the recent news.

See [PLAN.md](PLAN.md) for the layout, bindings and order of work, [DEPLOY.md](DEPLOY.md) for the one-time Cloudflare setup, and [AGENTS.md](AGENTS.md) for the working rules.

```sh
pnpm install
pnpm check   # Biome + typecheck
```
