// Creates the Cloudflare resources the pipeline binds, if they don't exist yet. Runs before
// `wrangler deploy` from apps/pipeline. An "already exists" answer is fine; any other failure
// (usually a build token without Queues or Vectorize permission) is reported and the deploy goes
// on, so the error surfaces from wrangler deploy with the resource named. DEPLOY.md has the
// same commands for running by hand.
import { spawnSync } from "node:child_process"

const INDEX = "digest-articles"

const steps: string[][] = [
  ["queues", "create", "process-q"],
  ["queues", "create", "process-dlq"],
  ["vectorize", "create", INDEX, "--dimensions=1024", "--metric=cosine"],
  ["vectorize", "create-metadata-index", INDEX, "--property-name=published_at", "--type=number"],
  ["vectorize", "create-metadata-index", INDEX, "--property-name=category", "--type=string"],
  ["vectorize", "create-metadata-index", INDEX, "--property-name=source_id", "--type=number"],
]

for (const args of steps) {
  const res = spawnSync("wrangler", args, { encoding: "utf8" })
  const out = `${res.stdout}\n${res.stderr}`
  if (res.status === 0) {
    console.log(`ensure-resources: created ${args.slice(0, 3).join(" ")}`)
  } else if (/already exists|already has|duplicate/i.test(out)) {
    console.log(`ensure-resources: exists ${args.slice(0, 3).join(" ")}`)
  } else {
    console.warn(`ensure-resources: could not run wrangler ${args.join(" ")}:\n${out.trim()}`)
  }
}
