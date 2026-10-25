// Copies Workers Builds build variables into the Worker's runtime secrets, so each value is set once.
// Run from an app directory after `wrangler deploy`:  node ../../scripts/sync-secrets.ts NAME...
import { spawnSync } from "node:child_process"

const names = process.argv.slice(2)
const present = Object.fromEntries(names.flatMap((n) => (process.env[n] ? [[n, process.env[n]]] : [])))
const missing = names.filter((n) => !(n in present))
if (missing.length > 0) console.warn(`sync-secrets: not set, skipped: ${missing.join(", ")}`)

if (Object.keys(present).length > 0) {
  const res = spawnSync("wrangler", ["secret", "bulk"], {
    input: JSON.stringify(present),
    stdio: ["pipe", "inherit", "inherit"],
  })
  if (res.status !== 0) process.exit(res.status ?? 1)
}
