# Deploying

Each Worker is a Cloudflare Workers Builds project linked to this repo. Every push to `main` builds and
deploys it, so nothing in this repo needs Cloudflare credentials. The `pipeline` deploy also applies D1
migrations and upserts the source seed before `wrangler deploy`.

| Worker            | Root directory  | Build command | Deploy command    | What the deploy does                                       |
| ----------------- | --------------- | ------------- | ----------------- | ---------------------------------------------------------- |
| `digest-pipeline` | `apps/pipeline` | _(empty)_     | `pnpm run deploy` | `d1 migrations apply` → seed upsert → `wrangler deploy`    |
| `digest-ingress`  | `apps/ingress`  | _(empty)_     | `pnpm run deploy` | `wrangler deploy` (custom domain `hooks.dd.nipatiitti.fi`) |

Workers Builds installs the whole pnpm workspace from the root lockfile, takes Node 24 from `.nvmrc` and pnpm
from `packageManager`. Migrations must stay additive, since both Workers deploy from the same commit in parallel.

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
   - Optional build watch paths: `apps/<app>/*`, `packages/*`, `pnpm-lock.yaml`.
   - If the pipeline deploy fails on `d1 migrations apply` with an auth error, give the build's API token
     **D1 Edit** (Settings → Builds → API token).

5. **Secrets** (Worker → Settings → Variables and Secrets → Add, type _Secret_). They survive deploys.

   | Worker            | Secret                    | Value              |
   | ----------------- | ------------------------- | ------------------ |
   | `digest-pipeline` | `TELEGRAM_BOT_TOKEN`      | bot token          |
   | `digest-ingress`  | `TELEGRAM_BOT_TOKEN`      | bot token          |
   | `digest-ingress`  | `TELEGRAM_WEBHOOK_SECRET` | secret from step 2 |

   `ANTHROPIC_API_KEY` isn't used yet.

6. **Register the webhook** once ingress is live:

   ```sh
   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url=https://hooks.dd.nipatiitti.fi/telegram \
     -d secret_token=$TELEGRAM_WEBHOOK_SECRET \
     -d 'allowed_updates=["message","callback_query"]'
   ```

7. **Chat ID**: send `/start` to the bot and it replies with the chat ID. **Send it back** (comma-separate
   several). It goes in `TELEGRAM_CHAT_IDS` in both `wrangler.jsonc` files.

## Values to send back

- D1 `database_id` for `digest`
- Telegram chat ID(s) for the allowlist

## Checking it works

- **Polling**: Workers Logs for `digest-pipeline` show a `fetched` line per source as polls come due.
- **Digest**: arrives at 07:00 UTC. To try it sooner, trigger the `digest` Workflow (dashboard → Workflows →
  digest → Trigger, or `npx wrangler workflows trigger digest '{"date":"test-1"}'`). Use a date other than
  today's, because each `date` sends at most once.
- **Feedback**: tap 👍 on the digest and a `feedback` row appears
  (`npx wrangler d1 execute digest --remote --command "select * from feedback"`).
