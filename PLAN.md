# Daily digest v2

A personal news and trend platform. The v1 scaffolding plan (security digest, stories, rubric scoring) lives in git
history before 3 Nov 2026. AGENTS.md has the working rules, DEPLOY.md the one-time setup.

## Decisions

| Question         | Decision                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| What is relevant | World significance first (`event_codes`); the profile's niche interests only lift (`interest`), mutes hold |
| Unit of news     | An event (one real-world happening), clustered from English gists of articles                              |
| Unit of trends   | A thread (a development over days or weeks); volume counted from its events' articles                      |
| Unit of items    | A story (a running matter over months or years): at most one item an edition, only on a major change       |
| Ranking          | `min(100, significance x interest boost) / 100 x corroboration x freshness`, in code                       |
| Digest           | Two editions, `20 6 * * *` and `20 15 * * *`; a gate at 60, a Haiku change judgment, Sonnet copy, no min   |
| Embeddings       | `@cf/baai/bge-m3`, 1024-d, cosine, over `titleEn` and `gist`, in Vectorize `digest-gists`                  |
| Dashboard        | Reader first: Home, threads, entities, countries, events, profile, digest archive, one status page         |
| Security         | One interest among others: a critical flaw in widely used software is significant on its own               |
| Tests            | None; `pnpm check` is the gate                                                                             |
| Git flow         | Commit straight to `main`, no PRs                                                                          |
| Hostnames        | `dd.nipatiitti.fi` (dashboard, behind Access), `hooks.dd.nipatiitti.fi` (ingress)                          |

## Pipeline

1. **Fetch** (minute cron, `fetch-q`): unchanged polling and parsing. Each new article sends a wake-up to `facet-q`.
2. **Ingest** (`facet-q`, concurrency 1, `apps/pipeline/src/ingest.ts`): a pull run over the oldest un-ingested
   articles (`FACETS.perRun`). Haiku writes `article_facets` in batches (English title, gist, typed entities,
   countries involved from the text, event type, advisory, opinion, roundup and promotional flags); the gist is
   embedded into `digest-gists`. Each article joins an event by gist cosine plus shared entities (`CLUSTER`), with
   Haiku asked in the band, and every placement is logged in `event_articles`. Event counters, centroid, countries
   and entities (`event_entities`, `entities.event_count`) are recomputed from the members. The minute cron sends a
   wake-up while a backlog exists, so a first deploy or a stall drains on its own.
3. **Hourly** (`apps/pipeline/src/hourly.ts`):
   - consolidate: young events compared by centroid across everything, every pair decision kept in `pair_decisions`
     so no pair is asked twice;
   - threads: substantial events (`SUBSTANTIAL`) join a candidate thread or start one, Haiku deciding and Sonnet
     naming with the nearest threads shown; quiet threads close after 30 days and reopen on a new event;
   - rollups by source, entity, thread and country, then momentum;
   - stories: Haiku puts threads into running stories, proposes one or keeps a one-off thread out, Sonnet naming
     with the nearest stories shown; a storyless thread is asked again as it grows;
   - coding: Haiku codes substantial events profile-free, for any field: act, material or talk, significance by
     people and systems affected, valence, stance for interactions, actors; again as origins double or grow;
   - interest: Haiku marks substantial events 0 to 3 against the current profile and whether a mute describes them,
     again when the profile version changes or the event's origins double;
   - movers: the hour's largest risers across threads, entities and countries, with a one-line reason for the top
     five;
   - alerts: followed threads and entities with an official source or a velocity spike.
4. **Editions** (`digest-v2` Workflow, `apps/pipeline/src/digest-v2.ts`): unsent candidates changed since the
   previous edition are coded, threaded, put in stories and marked where the hourly loop has not yet, then grouped
   by story, else thread, else event. A group's gate is its best material event's significance times the interest
   boost, at most 100; it needs `EDITION.minSignificance`, and a story group also a major change since the reader's
   last brief on it (a Haiku judgment, carried by the events it names). Talk never qualifies. Items rank by gate,
   corroboration and freshness, at most 8 and no minimum; Sonnet writes copy that says only what changed and may
   skip an item as talk. Every candidate's outcome goes to `edition_judgments`, the items to `edition_items`, which
   are the reader's state. `mode` is `send` or `replay` (a past edition as of its send time, written with mode
   replay, `scripts/replay-editions.ts`).
5. **Nightly** (03:30 UTC): close quiet events, database stats, and the reactions step that turns new
   votes into `profile_proposals` for `/profile`.

The v1 story pipeline sent the editions until the switch on 4 Nov 2026; its tables stay, read only by the
dashboard's archive of v1 editions and by votes on v1 messages, until a later migration drops them.

## Layout

```text
apps/
  pipeline/     Worker: crons, fetch-q, facet-q, Workflow DigestV2
  ingress/      Worker: grammY webhook for votes (hooks.dd.nipatiitti.fi, outside Access)
  dashboard/    SvelteKit on adapter-cloudflare, dd.nipatiitti.fi behind Access; remote functions only
packages/
  db/           Drizzle schema, migrations, query helpers, source and profile seed
  core/         pure logic: feeds, URLs, countries, clustering helpers, ranking, rollups, forecast, config
  llm/          Claude client with the spend cap and llm_calls logging, prompts, model and price table
  telegram/     HTML escaping, item rendering, callback_data codec, chat allowlist
scripts/        set-webhook, sync-secrets, smoke-sources, replay-editions
```

- Packages are source-only TS (`"exports": { ".": "./src/index.ts" }`), bundled by wrangler and Vite.
- `core` imports nothing from the workspace; `telegram` may import `core`; `llm` may import `core` and `db`; `db`
  imports only Drizzle; packages never import apps.
- Every tunable number lives in `core/src/config.ts` with a `CONFIG_VERSION`.

## Tooling

- Node 24 (`.nvmrc`), pnpm 10 (`packageManager`), TypeScript 6 strict + `noUncheckedIndexedAccess`.
- `wrangler types` per app writes a committed `worker-configuration.d.ts` (no `@cloudflare/workers-types`).
- Biome for lint/format; `svelte-check` for the dashboard. `pnpm check` runs both plus `tsc --noEmit`.
- Feed parsing: `fast-xml-parser`, `htmlparser2` fallback for malformed XML.

## Bindings

All apps: the same pinned `compatibility_date`, `nodejs_compat`, observability on, `workers_dev` and `preview_urls`
off, one D1 `DB` → `digest` with `migrations_dir` → `packages/db/migrations`.

| Binding                                                                 | pipeline                                  | ingress                                         | dashboard                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Crons `* * * * *`, `0 * * * *`, `0 6 * * *`, `0 15 * * *`, `30 3 * * *` | yes                                       |                                                 |                                                                                     |
| Queue `fetch-q` + `fetch-dlq` (batch 10, concurrency 5)                 | produce + consume                         |                                                 |                                                                                     |
| Queue `facet-q` + `facet-dlq` (wake-ups, batch 100, concurrency 1)      | produce + consume                         |                                                 |                                                                                     |
| Workflow `DIGEST_V2`                                                    | yes                                       |                                                 |                                                                                     |
| Workers AI `AI`                                                         | yes                                       |                                                 | yes (Ask search)                                                                    |
| Vectorize `GISTS` → `digest-gists`                                      | yes                                       |                                                 | yes (Ask search)                                                                    |
| Secrets                                                                 | `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | `ANTHROPIC_API_KEY`                                                                 |
| Vars                                                                    | `TELEGRAM_CHAT_IDS`, `MONTHLY_BUDGET_USD` | `TELEGRAM_CHAT_IDS`                             | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `DASHBOARD_SPEND_CAP_USD`, `MONTHLY_BUDGET_USD` |
- Edition idempotency: send mode claims `digests(digest_date)` with `ON CONFLICT DO NOTHING`; a replay replaces its
  own `edition_items` and `edition_judgments` rows.
- Queue messages carry IDs only; Workflow steps return small JSON, never vectors or full text.
- Cloudflare resources are created by hand (DEPLOY.md), never by the deploy.

## Drizzle and D1

1. Schema in `packages/db/src/schema/`, one file per area. `pnpm db:generate`, then the pipeline deploy applies
   migrations.
2. Integer PKs; timestamps as unix ms; `*_json` columns as typed `text({ mode: "json" })`; float32 vectors as BLOBs
   through `vector()` in `schema/common.ts`.
3. D1 rejects statements with more than 100 bound parameters: chunk `inArray` lists and multi-row inserts.
4. `event_articles` is both membership and the placement log for calibrating `CLUSTER`; `pair_decisions` is the
   negative cache for consolidation.
5. `llm_answers` keeps Ask answers by the SHA-256 of their input; only purpose `ask` counts against
   `DASHBOARD_SPEND_CAP_USD` per day; `MONTHLY_BUDGET_USD` holds every purpose, and each day's allowance is what the
   month has left over the days left (`dailyAllowance` in `core/src/spend.ts`).

Traps:
- A drizzle-kit table rebuild drops FTS triggers; follow it with a custom migration that recreates them.
- D1 enforces foreign keys and ignores `PRAGMA foreign_keys = OFF`; swap generated rebuilds to
  `PRAGMA defer_foreign_keys = on`.

## CI/CD

Each Worker is a Workers Builds project linked to the repo (deploy command `pnpm run deploy:<app>`), so every push to
`main` deploys. The pipeline's deploy applies migrations and upserts the source and profile seed before
`wrangler deploy`. Migrations stay additive, because both Workers deploy the same commit in parallel.

## Order of work

1. Phase 0, done 3 Nov: Finland from a country list, theme cooldown, one Haiku dedupe, advisory floor.
2. v2 schema, facets, events, threads, relevance, the v2 digest in shadow, the dashboard and the feedback loop,
   done 3 Nov.
3. Backfill and replay: the first v2 deploy drains every stored article; then `node scripts/replay-editions.ts`
   writes what v2 would have sent for every past edition, to compare on `/digest/<key>`.
4. Switch, done 4 Nov: `EDITION.mode = "send"`, the v1 code deleted, then its resources (`digest-articles`,
   `process-q`, `process-dlq`, the `digest` and `story-eval` Workflows).
5. A later deploy drops the retired tables and columns once no Worker reads them.
