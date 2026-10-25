# Deploying

Each Worker is a Cloudflare Workers Builds project linked to this repo. Every push to `main` builds and
deploys it, so nothing in this repo needs Cloudflare credentials. The `pipeline` deploy also applies D1
migrations and upserts the source seed before `wrangler deploy`.

| Worker            | Root directory | Deploy command             | What the deploy does                                                          |
| ----------------- | -------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `digest-pipeline` | _(empty)_      | `pnpm run deploy:pipeline` | D1 migrations → seed upsert → `wrangler deploy` → sync secrets                |
| `digest-ingress`  | _(empty)_      | `pnpm run deploy:ingress`  | `wrangler deploy` (`hooks.dd.nipatiitti.fi`) → sync secrets → set the webhook |

Build command is empty for both. The root directory is the repo root: the root scripts hand off to the app with
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
   ```

   The `digest` Workflow is created by the first deploy. `nipatiitti.fi` must be a zone on the same account,
   because the ingress deploy attaches `hooks.dd.nipatiitti.fi` as a custom domain.

2. **Telegram bot**: create it with @BotFather and keep the token. Make a webhook secret with
   `openssl rand -hex 32` (Telegram allows `A-Z a-z 0-9 _ -`).

3. **Send back the D1 `database_id`** that step 1 prints. It goes in both `wrangler.jsonc` files.

4. **Workers Builds projects** (Workers & Pages → Create → Import a repository → `nipatiitti/daily-digest`), one
   per row of the table above:
   - The project name must equal `name` in that app's `wrangler.jsonc` (`digest-pipeline`, `digest-ingress`).
   - Production branch `main`; turn off builds for non-production branches.
   - Optional build watch paths: `apps/<app>/*`, `packages/*`, `scripts/*`, `pnpm-lock.yaml`.
   - If the pipeline deploy fails on `d1 migrations apply` with an auth error, give the build's API token
     **D1 Edit** (Settings → Builds → API token).

5. **Build variables** (Worker → Settings → Builds → Variables and secrets). Mark them as secrets.

   | Worker            | Variable                  | Value              |
   | ----------------- | ------------------------- | ------------------ |
   | `digest-pipeline` | `TELEGRAM_BOT_TOKEN`      | bot token          |
   | `digest-ingress`  | `TELEGRAM_BOT_TOKEN`      | bot token          |
   | `digest-ingress`  | `TELEGRAM_WEBHOOK_SECRET` | secret from step 2 |

   The deploy copies them into runtime secrets and registers the webhook, so there's nothing else to set.
   `ANTHROPIC_API_KEY` isn't used yet.

6. Retry the deploys. The ingress log ends with `set-webhook: https://hooks.dd.nipatiitti.fi/telegram`.

7. **Chat ID**: send `/start` to the bot and it replies with the chat ID. **Send it back** (comma-separate
   several). It goes in `TELEGRAM_CHAT_IDS` in both `wrangler.jsonc` files.

## Checking it works

- **Polling**: Workers Logs for `digest-pipeline` show a `fetched` line per source as polls come due.
- **Digest**: arrives at 07:00 UTC. To try it sooner, trigger the `digest` Workflow (dashboard → Workflows →
  digest → Trigger, or `npx wrangler workflows trigger digest '{"date":"test-1"}'`). Use a date other than
  today's, because each `date` sends at most once.
- **Feedback**: tap 👍 on the digest and a `feedback` row appears
  (`npx wrangler d1 execute digest --remote --command "select * from feedback"`).
