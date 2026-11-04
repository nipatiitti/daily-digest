# Deploying

Each Worker is a Cloudflare Workers Builds project linked to this repo. Every push to `main` builds and
deploys it, so nothing in this repo needs Cloudflare credentials. The `pipeline` deploy also applies D1
migrations and upserts the source seed before `wrangler deploy`.

| Worker             | Root directory | Deploy command              | What the deploy does                                                                         |
| ------------------ | -------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `digest-pipeline`  | _(empty)_      | `pnpm run deploy:pipeline`  | `pnpm check` → D1 migrations → seed upsert → `wrangler deploy` → sync secrets                |
| `digest-ingress`   | _(empty)_      | `pnpm run deploy:ingress`   | `pnpm check` → `wrangler deploy` (`hooks.dd.nipatiitti.fi`) → sync secrets → set the webhook |
| `digest-dashboard` | _(empty)_      | `pnpm run deploy:dashboard` | `pnpm check` → `vite build` → `wrangler deploy` (`dd.nipatiitti.fi`) → sync secrets          |

Build command is empty for all three; the dashboard's `vite build` runs inside its deploy script. The root directory is the repo root: the root scripts hand off to the app with
`pnpm --filter`, so Workers Builds installs the whole workspace from the root lockfile. It takes Node 24 from
`.nvmrc` and pnpm from `packageManager`. Migrations must stay additive, since both Workers deploy from the same
commit in parallel.

Secrets are set once, as **build variables** on the Workers Builds project. After `wrangler deploy`,
`scripts/sync-secrets.ts` copies them into the Worker's runtime secrets (`wrangler secret bulk`), and the ingress
deploy then runs `scripts/set-webhook.ts`, which registers `https://hooks.dd.nipatiitti.fi/telegram` with the
secret token. Both skip quietly when the variables aren't set.

## One-time setup

1. **Cloudflare resources** (dashboard, or `npx wrangler login` then):

   ```sh
   npx wrangler d1 create digest
   npx wrangler queues create fetch-q
   npx wrangler queues create fetch-dlq
   npx wrangler queues create facet-q
   npx wrangler queues create facet-dlq
   npx wrangler vectorize create digest-gists --dimensions=1024 --metric=cosine
   npx wrangler vectorize create-metadata-index digest-gists --property-name=published_at --type=number
   ```

   The deploy never creates resources; `wrangler deploy` fails on a binding whose queue or index is missing.
   The metadata index must exist before the first vector is inserted. The `digest-v2` Workflow is created by the
   first deploy. `nipatiitti.fi` must be a zone on the same account,
   because the ingress deploy attaches `hooks.dd.nipatiitti.fi` as a custom domain.

2. **Telegram bot**: create it with @BotFather and keep the token. Make a webhook secret with
   `openssl rand -hex 32` (Telegram allows `A-Z a-z 0-9 _ -`).

3. **Send back the D1 `database_id`** that step 1 prints. It goes in both `wrangler.jsonc` files.

4. **Workers Builds projects** (Workers & Pages → Create → Import a repository → `nipatiitti/daily-digest`), one
   per row of the table above:
   - The project name must equal `name` in that app's `wrangler.jsonc` (`digest-pipeline`, `digest-ingress`,
     `digest-dashboard`).
   - Production branch `main`; turn off builds for non-production branches.
   - Optional build watch paths: `apps/<app>/*`, `packages/*`, `scripts/*`, `pnpm-lock.yaml`.
   - If the pipeline deploy fails on `d1 migrations apply` with an auth error, give the build's API token
     **D1 Edit** (Settings → Builds → API token).

5. **Build variables** (Worker → Settings → Builds → Variables and secrets). Mark them as secrets.

   | Worker             | Variable                  | Value              |
   | ------------------ | ------------------------- | ------------------ |
   | `digest-pipeline`  | `TELEGRAM_BOT_TOKEN`      | bot token          |
   | `digest-ingress`   | `TELEGRAM_BOT_TOKEN`      | bot token          |
   | `digest-ingress`   | `TELEGRAM_WEBHOOK_SECRET` | secret from step 2 |
   | `digest-pipeline`  | `ANTHROPIC_API_KEY`       | Anthropic API key  |
   | `digest-dashboard` | `ANTHROPIC_API_KEY`       | Anthropic API key  |

   The deploy copies them into runtime secrets and registers the webhook, so there's nothing else to set.
   Without `ANTHROPIC_API_KEY` the pipeline still runs: ingest writes facets from code and clusters by threshold
   alone, and nothing is scored, threaded or extracted. `DAILY_SPEND_CAP_USD` in `apps/pipeline/wrangler.jsonc` caps
   Claude spend per UTC day: 8 on the 4 Nov 2026 switch day, then 3.33. Ingest
   facets may run to `FACETS.capMultiplier` times it; the hourly threads, relevance and movers steps skip once the
   day's spend passes the `EVAL.spendSoftCap` share of it. `ANTHROPIC_BASE_URL` can be added as a var later to route through AI Gateway.

6. **Cloudflare Access for the dashboard** (Zero Trust → Access → Applications → Add → Self-hosted):
   - Application domain `dd.nipatiitti.fi`, with a policy that allows only your email.
   - Copy the application's **AUD tag** into `ACCESS_AUD` in `apps/dashboard/wrangler.jsonc`, and the team
     domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. Neither is secret.
   - Access stops strangers at the edge. The Worker verifies the `Cf-Access-Jwt-Assertion` header against
     the team's keys as well and answers 403 on every page and remote call without it, or when either var is
     empty. Static build assets are covered by Access alone.

   The dashboard's other vars: `DAILY_SPEND_CAP_USD` mirrors the pipeline's cap for the status page, and
   `DASHBOARD_SPEND_CAP_USD` (2) caps Claude spend per UTC day on Ask on the home page (`llm_calls` purpose `ask`,
   the only one that counts against it); an answer over the cap gets a 402. Without the dashboard's
   `ANTHROPIC_API_KEY` Ask answers that Claude is not set up, and stored answers still show. `vite dev` skips the
   Access check and reads the production D1 (`"remote": true`), which needs `npx wrangler login`.

7. Retry the deploys. The ingress log ends with `set-webhook: https://hooks.dd.nipatiitti.fi/telegram`.

8. **Chat ID**: send `/start` to the bot and it replies with the chat ID. **Send it back** (comma-separate
   several). It goes in `TELEGRAM_CHAT_IDS` in the pipeline and ingress `wrangler.jsonc` files.

## Checking it works

- **Polling**: Workers Logs for `digest-pipeline` show a `fetched` line per source as polls come due.
- **Feeds**: `node scripts/smoke-sources.ts --all` fetches every seeded source with the real parser and prints one
  line each (status, items, newest item age). Node 24, or `--experimental-strip-types` on 22.
- **Digest**: the morning edition arrives at 06:00 UTC and the afternoon one at 15:00 UTC. To try it sooner, trigger
  the `digest-v2` Workflow
  (`npx wrangler workflows trigger digest-v2 '{"date":"test-1","edition":"morning","mode":"shadow"}'`), which writes
  `digests_shadow` and sends nothing; `/digest/test-1` shows it.
- **Ingest**: an `ingest` line per `facet-q` batch with counts by placement (`new`, `join`, `copy`, `ask-yes`,
  `ask-no`) and a `placed` line per article. The first deploy finds every stored article un-ingested and drains it
  oldest first, one batch a minute; `/status` shows the backlog. `select count(*) from article_facets` tracks
  `articles`.
- **Feedback**: tap 👍 on the digest and a `feedback` row appears
  (`npx wrangler d1 execute digest --remote --command "select * from feedback"`).
