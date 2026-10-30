# Scaffolding plan

Living version: the "Daily digest: scaffolding plan" doc. This file is the repo copy as of 25 Oct 2026, with the
27 Oct review ("Daily digest: design review" doc) folded into Decisions and Order of work. AGENTS.md has the
working rules.

## Decisions

| Question                                          | Decision                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Digest time                                       | `0 7 * * *` every day (drifts to 09:00 Helsinki in winter)                                     |
| Embeddings                                        | `@cf/baai/bge-m3`, 1024-d, cosine. No benchmark                                                |
| Tests                                             | None                                                                                           |
| Git flow                                          | Commit straight to `main`, no PRs                                                              |
| Hostnames                                         | `dd.nipatiitti.fi` (dashboard, behind Access), `hooks.dd.nipatiitti.fi` (ingress)              |
| Backups                                           | D1 Time Travel (FTS5 virtual tables block `wrangler d1 export`)                                |
| Lint/format                                       | Biome                                                                                          |
| Feed ingestion                                    | Pure polling, no WebSub                                                                        |
| Chat allowlist                                    | `TELEGRAM_CHAT_IDS` var                                                                        |
| Order of work                                     | Embedding-first as planned (27 Oct review proposed a batch digest first; Niilo chose the plan) |
| Claude access                                     | Direct API first (`ANTHROPIC_API_KEY`); AI Gateway later via `ANTHROPIC_BASE_URL`              |
| Signal sources                                    | Tier D (HN, Bluesky, Google Trends, Lobsters) disabled until `signals` has an ingestion path   |
| MSRC                                              | Disabled: 5,000+ CVE items per fetch; Microsoft issues arrive via KEV and news feeds           |
| Opus edit, Browser Rendering, Kagi recall, Follow | Deferred until a real digest shows the need                                                    |

## Layout

```text
apps/
  pipeline/     Worker: minute cron, fetch-q + process-q consumers, StoryEval + Digest Workflows, maintenance cron
                hourly loop: rollups, entities (fold extraction names into `entities` + `story_entities`), themes, momentum, brief
                themes: embed newly extracted stories, Haiku joins each to a candidate theme or proposes one, Sonnet names or merges it,
                then provisional themes with enough stories or score turn active and quiet ones close
                brief: Haiku writes one paragraph into `briefs` from the readouts, the largest 24h movers (by SIG/STY id only) and
                the previous brief, plus a line per moving signal into `themes.explanation`; signals whose momentum moved
                `BRIEF.explainBandPct` points since their last explanation get a new one
  ingress/      Worker: grammY webhook (hooks.dd.nipatiitti.fi, outside Access)
  dashboard/    SvelteKit 3 on adapter-cloudflare (Workers Static Assets), dd.nipatiitti.fi behind Access; remote functions only, bindings from cloudflare:workers
packages/
  db/           Drizzle schema, generated + hand-written migrations, query helpers, source seed
  core/         pure logic: feed parsing, canonical URLs, dedupe, clustering, scoring, gates, Zod schemas, config
  llm/          Claude client via AI Gateway, prompts, model + price table, spend cap
  telegram/     HTML escaping, item rendering, callback_data codec, chat allowlist
scripts/        bootstrap.sh (Cloudflare resources), set-webhook, seed
```

- Packages are source-only TS (`"exports": { ".": "./src/index.ts" }`), bundled by wrangler/Vite.
- `core` imports nothing from the workspace; `telegram` may import `core`; `llm` may import `core` and `db` (spend cap and `llm_calls` logging); `db` imports only Drizzle; packages never import apps.
- Each Worker's `src/index.ts` only wires `env` into package functions.
- Every _(calibrate)_ number lives in `core/src/config.ts` with a `CONFIG_VERSION`.
- Sources live in `packages/db/seed/sources.ts`; the seed script upserts config columns only, never runtime state, except `enabled`, which the dashboard owns after insert.

## Tooling

- Node 24 (`.nvmrc`), pnpm 10 (`packageManager`), TypeScript 6 strict + `noUncheckedIndexedAccess`.
- `wrangler types` per app writes a committed `worker-configuration.d.ts` (no `@cloudflare/workers-types`).
- Biome for lint/format; `svelte-check` for the dashboard. `pnpm check` runs both plus `tsc --noEmit`.
- Local dev: `wrangler dev` per app with a shared `--persist-to .wrangler/state`; Workers AI and Vectorize as remote bindings.
- Feed parsing: `fast-xml-parser`, `htmlparser2` fallback for malformed XML.

## Bindings

All apps: same pinned `compatibility_date`, `nodejs_compat`, observability on, `workers_dev` and `preview_urls` off, one D1 `DB` → `digest` with `migrations_dir` → `packages/db/migrations`. One remote environment (production) plus local.

| Binding                                                                                                                                | pipeline                                                                     | ingress                                         | dashboard                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D1 `DB`                                                                                                                                | yes                                                                          | yes                                             | yes                                                                                                       |
| Crons `* * * * *` scheduler, `0 * * * *` hourly, `0 7 * * *` digest, `30 3 * * *` maintenance, `15 12 * * *` Kagi recall               | yes                                                                          |                                                 |                                                                                                           |
| Queue `fetch-q` + `fetch-dlq` (batch 10, concurrency 5)                                                                                | produce + consume                                                            |                                                 |                                                                                                           |
| Queue `process-q` + `process-dlq` (batch 50, 5 s timeout)                                                                              | produce + consume                                                            |                                                 |                                                                                                           |
| Workflow `STORY_EVAL` (`StoryEval`)                                                                                                    | yes                                                                          |                                                 | yes, via `script_name`                                                                                    |
| Workflow `DIGEST` (`Digest`), started by cron `0 7 * * *` with instance ID `digest-YYYY-MM-DD`                                         | yes                                                                          |                                                 | yes, via `script_name`                                                                                    |
| R2 `FULLTEXT` → `digest-fulltext`                                                                                                      | yes                                                                          |                                                 |                                                                                                           |
| Workers AI `AI`, Browser Rendering `BROWSER`                                                                                           | yes                                                                          |                                                 |                                                                                                           |
| Vectorize `VECTORS` → `digest-articles` (1024-d, cosine; metadata indexes `published_at`, `category`, `source_id` before first insert) | yes                                                                          |                                                 |                                                                                                           |
| Secrets                                                                                                                                | `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`                    | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`                                                                 |
| Vars                                                                                                                                   | `CF_ACCOUNT_ID`, `AI_GATEWAY_ID`, `TELEGRAM_CHAT_IDS`, `DAILY_SPEND_CAP_USD` | `TELEGRAM_CHAT_IDS`                             | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `DASHBOARD_SPEND_CAP_USD`, `DAILY_SPEND_CAP_USD`, `TELEGRAM_CHAT_IDS` |
- One `scheduled` handler switches on `controller.cron`.
- Digest idempotency: the first step inserts into `digests(digest_date)` with `ON CONFLICT DO NOTHING`; a lost claim ends the run (scheduled instances get generated IDs).
- Queue messages carry IDs only (128 KB cap); Workflow steps return R2 keys, not full text (~1 MiB step result cap).
- Ingestion is pure polling; no WebSub (brief's `websub_*` columns dropped).
- Cloudflare resources are created by hand (DEPLOY.md), never by the deploy; `scripts/set-webhook` registers Telegram with the secret token and `allowed_updates: ["message", "callback_query"]`; `scripts/smoke-sources.ts` fetches every seeded feed with the real parser.
- Failed sources back off: the poll interval doubles per consecutive failure, capped at 24 h.
- `process-q` runs with concurrency 1 and compares articles within a batch in memory, because Vectorize indexes asynchronously and two concurrent batches about one event would each start a story.

## Drizzle and D1

1. Schema in `packages/db/src/schema/`, one file per area. `drizzle.config.ts`: `dialect: "sqlite"`, `out: "./migrations"`, `d1-http` driver only for studio.
2. `pnpm db:generate` (`drizzle-kit generate`), then `wrangler d1 migrations apply digest --local|--remote`.
3. FTS5 via `drizzle-kit generate --custom --name=fts`: external-content `articles_fts`, `stories_fts`, `tokenize = "unicode61 remove_diacritics 2"`, `prefix = "2 3"`, plus triggers. `entities_fts` over `entities.name` the same way (`--name=entities_fts`), and `themes_fts` over `themes.name, description` (`--name=themes_fts`).
4. Integer PKs for `articles`, `stories`, `facts`, `deliveries` (rowid alias for FTS5, short `callback_data`). Timestamps as unix ms; `*_json` columns as typed `text({ mode: "json" })`.
5. Dedupe via unique constraints: `articles.canonical_url`, `(source_id, guid)`, `telegram_updates.update_id`, `digests.digest_date`.
6. `getDb(env.DB)`, `chunkedBatch()` (100 bound params per statement), typed query helpers per stage.
7. `match_log` keeps one row per article placement (how, best candidate story and its cosine) for calibrating `MATCH`.
8. `briefs` keeps one row per hourly brief: `at`, the text, `movers_json` (the readouts and movers it was written from) and the `llm_calls` row of the call that wrote it. The front page shows the newest, `/briefs` the history.
9. `llm_answers` keeps on-demand dashboard answers (purposes `explain`, `compare`, `review`, `ask`, which only the dashboard uses) by purpose, subject and the SHA-256 of the model, system prompt and prompt, so `POST /api/answer` returns the stored text until the input changes and otherwise streams a new one. Only their `llm_calls` rows count against `DASHBOARD_SPEND_CAP_USD`, and the pipeline's `DAILY_SPEND_CAP_USD` counts every other purpose. "Explain the score" on the story page is the first.

Traps:
- A drizzle-kit table rebuild (`__new_articles`) drops FTS triggers; follow it with a custom migration that recreates them.
- D1 enforces foreign keys and ignores `PRAGMA foreign_keys = OFF`; swap generated rebuilds to `PRAGMA defer_foreign_keys = on`.

## CI/CD

Each Worker is a Cloudflare Workers Builds project linked to the repo (repo root, deploy command `pnpm run deploy:<app>`), so every push to `main` deploys without Cloudflare credentials in GitHub. The pipeline's deploy applies `wrangler d1 migrations apply digest --remote` and the source seed before `wrangler deploy`. Migrations stay additive. The GitHub workflow only runs `pnpm check`. Secrets are set once as Workers Builds build variables and copied into runtime secrets by the deploy. One-time steps are in [DEPLOY.md](DEPLOY.md).

## Order of work

Done when a walking skeleton runs in production: at 07:00 UTC a "Nothing notable today" digest arrives in Telegram and tapping 👍 writes a `feedback` row.

1. Repo foundation. Done.
2. Database package: full schema, FTS migration, source seed. Done.
3. Pipeline skeleton: all bindings incl. Vectorize, scheduler, fetch consumer writing articles, process consumer embedding with bge-m3 and matching articles to stories (brief section 5: wire-copy collapse, cosine bands, Haiku in the ask band, CVE hard key, same-source penalty), evidence gate, StoryEval stub, Digest sending the empty digest, minimal `telegram`. Done 27 Oct; needs the Vectorize index and `process-q` created (DEPLOY.md).
4. Ingress: grammY webhook, secret check, `update_id` dedupe, callback answers, feedback writes, `set-webhook`. Done.
5. Real pipeline stages. Done 27 Oct: StoryEval (full text via `AI.toMarkdown` for the two leading origins, Sonnet extraction and rubric, EPSS and KEV enrichment into `vulns`, facts with Haiku novelty labels, score, alert gate in shadow mode, update gate), Digest reading stories (candidates since the previous digest, slotting in code, one message per item with badge, code-chosen links and votes, re-delivery only after the update gate passes), maintenance cron at 03:30 UTC (close stories quiet for 7 days, `db_stats`, stale sources in the log). 28 Oct after the first real digest: items cut to tag, headline, one sentence and a comma-separated source line (no "why it matters" shown, no middle dots), the extraction prompt limits `what_happened` to one sentence of 25 words, and the Digest workflow checks its top candidates pairwise for the same event (title overlap, else Haiku) and merges the loser into the winner before slotting, because the matcher kept a Finnish and an English version of one event apart. `MATCH.newStoryCosine` dropped to 0.65 so such pairs reach the Haiku ask at process time too. Slots since 28 Oct: 2 Finland (relevance 2, floor 45, filled first), 3 tech/security, 2 world. Not yet: nightly story merge pass, Following section, Opus edit, quiet hours and alert sending (shadow only), R2 full-text storage (fetched at eval time, not stored).
6. Dashboard shell: SvelteKit, Access JWT check in `hooks.server.ts`, digest archive, gate log. Pushed back behind the digest on 27 Oct. Digest archive done 30 Oct: `/digest` lists editions (UTC dates with digest or update deliveries) with story and vote counts, `/digest/<date>` shows each item re-rendered through `renderDigestItem` from the stored story with its score at send and votes, plus that day's alerts. "Send to Telegram now" on a story page sends it to every chat as an `alert` delivery with the vote row and writes a `send_now` audit row.
7. Calibration on two weeks of shadow gate logs, then alerts for real. Later: velocity signals, EUVD, HF trending and HTML-diff parsers, Kagi recall, Follow, Opus edit.
