# Scaffolding plan

Living version: the "Daily digest: scaffolding plan" doc. This file is the repo copy as of 25 Oct 2026.

## Decisions

| Question       | Decision                                                                          |
| -------------- | --------------------------------------------------------------------------------- |
| Digest time    | `0 7 * * *` every day (drifts to 09:00 Helsinki in winter)                        |
| Embeddings     | `@cf/baai/bge-m3`, 1024-d, cosine. No benchmark                                   |
| Tests          | None                                                                              |
| Git flow       | Commit straight to `main`, no PRs                                                 |
| Hostnames      | `dd.nipatiitti.fi` (dashboard, behind Access), `hooks.dd.nipatiitti.fi` (ingress) |
| Backups        | D1 Time Travel (FTS5 virtual tables block `wrangler d1 export`)                   |
| Lint/format    | Biome                                                                             |
| Feed ingestion | Pure polling, no WebSub                                                           |
| Chat allowlist | `TELEGRAM_CHAT_IDS` var                                                           |

## Layout

```text
apps/
  pipeline/     Worker: minute cron, fetch-q + process-q consumers, StoryEval + Digest Workflows, maintenance cron
  ingress/      Worker: grammY webhook (hooks.dd.nipatiitti.fi, outside Access)
  dashboard/    SvelteKit on adapter-cloudflare (Workers Static Assets), dd.nipatiitti.fi behind Access
packages/
  db/           Drizzle schema, generated + hand-written migrations, query helpers, source seed
  core/         pure logic: feed parsing, canonical URLs, dedupe, clustering, scoring, gates, Zod schemas, config
  llm/          Claude client via AI Gateway, prompts, model + price table, spend cap
  telegram/     HTML escaping, item rendering, callback_data codec, chat allowlist
scripts/        bootstrap.sh (Cloudflare resources), set-webhook, seed
```

- Packages are source-only TS (`"exports": { ".": "./src/index.ts" }`), bundled by wrangler/Vite.
- `core` imports nothing from the workspace; `llm` and `telegram` may import `core`; `db` imports only Drizzle; packages never import apps.
- Each Worker's `src/index.ts` only wires `env` into package functions.
- Every _(calibrate)_ number lives in `core/src/config.ts` with a `CONFIG_VERSION`.
- Sources live in `packages/db/seed/sources.ts`; the seed script upserts config columns only, never runtime state.

## Tooling

- Node 24 (`.nvmrc`), pnpm 10 (`packageManager`), TypeScript 6 strict + `noUncheckedIndexedAccess`.
- `wrangler types` per app writes a committed `worker-configuration.d.ts` (no `@cloudflare/workers-types`).
- Biome for lint/format; `svelte-check` for the dashboard. `pnpm check` runs both plus `tsc --noEmit`.
- Local dev: `wrangler dev` per app with a shared `--persist-to .wrangler/state`; Workers AI and Vectorize as remote bindings.
- Feed parsing: `fast-xml-parser`, `htmlparser2` fallback for malformed XML.

## Bindings

All apps: same pinned `compatibility_date`, `nodejs_compat`, observability on, `workers_dev` and `preview_urls` off, one D1 `DB` → `digest` with `migrations_dir` → `packages/db/migrations`. One remote environment (production) plus local.

| Binding                                                                                                                                | pipeline                                                                     | ingress                                         | dashboard                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| D1 `DB`                                                                                                                                | yes                                                                          | yes                                             | yes                                |
| Crons `* * * * *` scheduler, `30 3 * * *` maintenance, `15 12 * * *` Kagi recall                                                       | yes                                                                          |                                                 |                                    |
| Queue `fetch-q` + `fetch-dlq` (batch 10, concurrency 5)                                                                                | produce + consume                                                            |                                                 |                                    |
| Queue `process-q` + `process-dlq` (batch 50, 5 s timeout)                                                                              | produce + consume                                                            |                                                 |                                    |
| Workflow `STORY_EVAL` (`StoryEval`)                                                                                                    | yes                                                                          |                                                 |                                    |
| Workflow `DIGEST` (`Digest`, `schedules: ["0 7 * * *"]`)                                                                               | yes                                                                          |                                                 |                                    |
| R2 `FULLTEXT` → `digest-fulltext`                                                                                                      | yes                                                                          |                                                 |                                    |
| Workers AI `AI`, Browser Rendering `BROWSER`                                                                                           | yes                                                                          |                                                 |                                    |
| Vectorize `VECTORS` → `digest-articles` (1024-d, cosine; metadata indexes `published_at`, `category`, `source_id` before first insert) | yes                                                                          |                                                 |                                    |
| Secrets                                                                                                                                | `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`                    | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` |                                    |
| Vars                                                                                                                                   | `CF_ACCOUNT_ID`, `AI_GATEWAY_ID`, `TELEGRAM_CHAT_IDS`, `DAILY_SPEND_CAP_USD` | `TELEGRAM_CHAT_IDS`                             | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` |
- One `scheduled` handler switches on `controller.cron`.
- Digest idempotency: the first step inserts into `digests(digest_date)` with `ON CONFLICT DO NOTHING`; a lost claim ends the run (scheduled instances get generated IDs).
- Queue messages carry IDs only (128 KB cap); Workflow steps return R2 keys, not full text (~1 MiB step result cap).
- Ingestion is pure polling; no WebSub (brief's `websub_*` columns dropped).
- `scripts/bootstrap.sh` creates D1, R2, queues, Vectorize index, AI Gateway; `scripts/set-webhook` registers Telegram with the secret token and `allowed_updates: ["message", "callback_query"]`.

## Drizzle and D1

1. Schema in `packages/db/src/schema/`, one file per area. `drizzle.config.ts`: `dialect: "sqlite"`, `out: "./migrations"`, `d1-http` driver only for studio.
2. `pnpm db:generate` (`drizzle-kit generate`), then `wrangler d1 migrations apply digest --local|--remote`.
3. FTS5 via `drizzle-kit generate --custom --name=fts`: external-content `articles_fts`, `stories_fts`, `tokenize = "unicode61 remove_diacritics 2"`, `prefix = "2 3"`, plus triggers.
4. Integer PKs for `articles`, `stories`, `facts`, `deliveries` (rowid alias for FTS5, short `callback_data`). Timestamps as unix ms; `*_json` columns as typed `text({ mode: "json" })`.
5. Dedupe via unique constraints: `articles.canonical_url`, `(source_id, guid)`, `telegram_updates.update_id`, `digests.digest_date`.
6. `getDb(env.DB)`, `chunkedBatch()` (100 bound params per statement), typed query helpers per stage.

Traps:
- A drizzle-kit table rebuild (`__new_articles`) drops FTS triggers; follow it with a custom migration that recreates them.
- D1 enforces foreign keys and ignores `PRAGMA foreign_keys = OFF`; swap generated rebuilds to `PRAGMA defer_foreign_keys = on`.

## CI/CD

One workflow on push to `main`: install, `pnpm check`, then (once Cloudflare access exists) `wrangler d1 migrations apply digest --remote` and deploy pipeline → ingress → dashboard, in a single `concurrency` group. Migrations stay additive. GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; runtime secrets via `wrangler secret put` only.

## Order of work

Done when a walking skeleton runs in production: at 07:00 UTC a "Nothing notable today" digest arrives in Telegram and tapping 👍 writes a `feedback` row.

1. Repo foundation (this commit).
2. Database package: full schema, FTS migration, source seed.
3. Pipeline skeleton: all bindings incl. Vectorize, scheduler, fetch consumer writing articles, process consumer embedding with bge-m3, StoryEval stub, Digest sending the empty digest, minimal `telegram`, `bootstrap.sh`.
4. Ingress: grammY webhook, secret check, `update_id` dedupe, callback answers, feedback writes, `set-webhook`.
5. Dashboard shell: SvelteKit, Access JWT check in `hooks.server.ts`, digest archive. Deploy steps switch on.
6. Real pipeline stages, then calibration on two weeks of shadow gate logs.
