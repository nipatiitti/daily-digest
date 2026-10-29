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
   npx wrangler queues create process-q
   npx wrangler queues create process-dlq
   npx wrangler vectorize create digest-articles --dimensions=1024 --metric=cosine
   npx wrangler vectorize create-metadata-index digest-articles --property-name=published_at --type=number
   npx wrangler vectorize create-metadata-index digest-articles --property-name=category --type=string
   npx wrangler vectorize create-metadata-index digest-articles --property-name=source_id --type=number
   ```

   The deploy never creates resources; `wrangler deploy` fails on a binding whose queue or index is missing.
   The three metadata indexes must exist before the first vector is inserted. The `digest` and `story-eval`
   Workflows are created by the first deploy. `nipatiitti.fi` must be a zone on the same account,
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
   Without `ANTHROPIC_API_KEY` the pipeline still runs: the match step falls back to a plain threshold instead
   of asking Haiku, and nothing is extracted. `DAILY_SPEND_CAP_USD` in `apps/pipeline/wrangler.jsonc` (3.33) caps Claude spend per UTC day; the hourly themes step (Haiku per newly extracted story, Sonnet per new theme) counts against it and skips once the day's spend passes the `EVAL.spendSoftCap` share of it. `ANTHROPIC_BASE_URL` can be added as a var later to route through AI Gateway.

6. **Cloudflare Access for the dashboard** (Zero Trust → Access → Applications → Add → Self-hosted):
   - Application domain `dd.nipatiitti.fi`, with a policy that allows only your email.
   - Copy the application's **AUD tag** into `ACCESS_AUD` in `apps/dashboard/wrangler.jsonc`, and the team
     domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. Neither is secret.
   - Access stops strangers at the edge. The Worker verifies the `Cf-Access-Jwt-Assertion` header against
     the team's keys as well and answers 403 on every page and remote call without it, or when either var is
     empty. Static build assets are covered by Access alone.

   The dashboard's other vars: `DAILY_SPEND_CAP_USD` mirrors the pipeline's cap for the spend lamp, and
   `DASHBOARD_SPEND_CAP_USD` (2) caps Claude spend per UTC day on the on-demand answers, such as "Explain the score"
   on a story page. Those `llm_calls` rows carry the purposes `explain`, `compare`, `review` and `ask`, and only they
   count against it; an answer over the cap gets a 402. Without the dashboard's `ANTHROPIC_API_KEY` the buttons answer
   that Claude is not set up, and stored answers still show. It binds the pipeline's `digest`
   and `story-eval` Workflows by `script_name`, so deploy the pipeline first. `vite dev` skips the Access check
   and reads the production D1 (`"remote": true`), which needs `npx wrangler login`.

7. Retry the deploys. The ingress log ends with `set-webhook: https://hooks.dd.nipatiitti.fi/telegram`.

8. **Chat ID**: send `/start` to the bot and it replies with the chat ID. **Send it back** (comma-separate
   several). It goes in `TELEGRAM_CHAT_IDS` in both `wrangler.jsonc` files.

## Checking it works

- **Polling**: Workers Logs for `digest-pipeline` show a `fetched` line per source as polls come due.
- **Matching**: a `matched` line per new article with its `storyId` and `how` (`new`, `join`, `copy`, `cve`,
  `ask-yes`, `ask-no`). `select count(*) from stories` grows; `gate_log` gets an `evidence` row per touched
  story, and a `story_eval_stub` line appears when one crosses the bar.
- **Feeds**: `node scripts/smoke-sources.ts --all` fetches every seeded source with the real parser and prints one
  line each (status, items, newest item age). Node 24, or `--experimental-strip-types` on 22.
- **Digest**: arrives at 07:00 UTC. To try it sooner, trigger the `digest` Workflow (dashboard → Workflows →
  digest → Trigger, or `npx wrangler workflows trigger digest '{"date":"test-1"}'`). Use a date other than
  today's, because each `date` sends at most once.
- **Feedback**: tap 👍 on the digest and a `feedback` row appears
  (`npx wrangler d1 execute digest --remote --command "select * from feedback"`).
