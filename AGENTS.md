# Working rules for agents

Read this before changing anything. PLAN.md has the architecture and DEPLOY.md the one-time setup.

## User-facing text

Anything a reader sees: Telegram messages, dashboard pages, bot replies, digest headings.

- Never use the en dash `–`, the em dash `—` or the bullet `•`. Write a sentence, a comma, or a line break instead.
- Prompts to Claude must say the same, and the renderer strips those characters from model output anyway.
- Telegram uses `parse_mode: HTML`. Escape every string that did not come from our own code.
- The model never writes URLs, publisher names or timestamps. Those come from the database by ID.

## Git

- Commit straight to `main`. No branches, no pull requests.
- Author every commit as `Niilo Jaakkola <niilo.jaakkola@icloud.com>`. No `Co-Authored-By` lines, no tool or model names in commit messages.
- Run `pnpm check` before committing. The deploy runs it again and refuses to ship a commit that fails.
- Migrations stay additive. Both Workers deploy the same commit in parallel against one database.

## Code

- Biome formats and lints: 120 columns, no semicolons, 2-space indent, double quotes. Run `pnpm format`.
- Packages are source-only TypeScript. `core` imports nothing from the workspace, `db` imports only Drizzle, `llm` and `telegram` may import `core`, packages never import apps.
- Every tunable number lives in `packages/core/src/config.ts`. Bump `CONFIG_VERSION` when one changes.
- Sources live in `packages/db/seed/sources.ts`. Disable a feed with `enabled: false` and a comment saying why.
- No tests. The gate is `pnpm check`, plus `node scripts/smoke-sources.ts` when touching feeds or the parser.
