// Replays the sent editions through the v2 digest workflow, oldest first, each as of its send time, into
// digests_shadow (mode "replay"). Each instance finishes before the next starts, so cooldown and already-sent see the
// earlier replays. Prints one line per edition: key, item count and the headlines.
//   node scripts/replay-editions.ts                     every sent edition
//   node scripts/replay-editions.ts --from 2026-10-28   editions from that UTC date on
//   node scripts/replay-editions.ts --dry-run           list them without triggering anything
import { execFileSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { parseEditionKey } from "../packages/core/src/index.ts"

const PIPELINE = new URL("../apps/pipeline/", import.meta.url)
const POLL_MS = 5_000
const FINAL = ["complete", "errored", "terminated"]

const wrangler = (...args: string[]) =>
  execFileSync("npx", ["wrangler", ...args], { cwd: PIPELINE, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })

const i = process.argv.indexOf("--from")
const from = i === -1 ? null : (process.argv[i + 1] ?? "")
if (from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from takes a date, YYYY-MM-DD")
const dryRun = process.argv.includes("--dry-run")

const sql = `select digest_date as key, sent_at as sentAt from digests where status = 'sent' and sent_at is not null
  ${from ? `and digest_date >= '${from}'` : ""} order by sent_at`
const query = <T>(command: string) =>
  (JSON.parse(wrangler("d1", "execute", "digest", "--remote", "--json", "--command", command)) as { results: T[] }[])[0]
    ?.results ?? []
const editions = query<{ key: string; sentAt: number }>(sql)

// A replay as of an edition sees only ingested articles, so the backlog up to the last one must drain first.
const last = editions.at(-1)?.sentAt
const [{ n } = { n: 0 }] = last
  ? query<{ n: number }>(`select count(*) as n from articles a left join event_articles ea on ea.article_id = a.id
      where ea.article_id is null and a.fetched_at <= ${Number(last)}`)
  : []
if (n > 0) {
  console.log(`${n} articles fetched by the last edition are not ingested yet. Replay once the backlog drains.`)
  if (!dryRun) process.exit(1)
}

type Instance = { status: string; output?: { items?: number; headlines?: string[] }; error?: unknown }

for (const { key, sentAt } of editions) {
  const edition = parseEditionKey(key)
  if (!edition) {
    console.log(`${key}: skipped, not an edition key`)
    continue
  }
  if (dryRun) {
    console.log(`${key}: would replay as of ${new Date(sentAt).toISOString()}`)
    continue
  }
  const id = `digest-v2-replay-${key}-${Date.now()}`
  const params = JSON.stringify({ ...edition, mode: "replay", asOf: sentAt })
  wrangler("workflows", "trigger", "digest-v2", params, "--id", id)
  let instance: Instance
  do {
    await sleep(POLL_MS)
    instance = JSON.parse(wrangler("workflows", "instances", "describe", "digest-v2", id, "--json")) as Instance
  } while (!FINAL.includes(instance.status))
  if (instance.status !== "complete") {
    console.log(`${key}: ${instance.status} ${JSON.stringify(instance.error ?? null)}`)
    continue
  }
  const headlines = instance.output?.headlines ?? []
  console.log(`${key}: ${instance.output?.items ?? 0} items${headlines.length ? `: ${headlines.join("; ")}` : ""}`)
}
