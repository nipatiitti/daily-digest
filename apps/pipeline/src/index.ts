import { EDITION, type Edition, editionKey, FACETS } from "@digest/core"
import { getDb } from "@digest/db"
import type { DigestParams } from "./digest.ts"
import type { DigestV2Params } from "./digest-v2.ts"
import { type FetchMessage, fetchSource } from "./fetch.ts"
import { runHourly } from "./hourly.ts"
import { type IngestMessage, ingestArticles, ingestBacklog } from "./ingest.ts"
import { llmFor } from "./llm.ts"
import { runMaintenance } from "./maintenance.ts"
import { type ProcessMessage, processArticles } from "./process.ts"
import { scheduleDueSources } from "./scheduler.ts"
import type { StoryEvalParams } from "./story-eval.ts"

export { Digest } from "./digest.ts"
export { DigestV2 } from "./digest-v2.ts"
export { StoryEval } from "./story-eval.ts"

/** The v1 digest sends until EDITION.mode is "send"; the v2 one runs beside it in shadow mode until then. */
const startDigest = async (env: Env, scheduledTime: number, edition: Edition) => {
  const date = new Date(scheduledTime).toISOString().slice(0, 10)
  const key = editionKey(date, edition)
  const runs: [string, () => Promise<unknown>][] = [
    [
      `digest-v2-${key}`,
      () =>
        (env.DIGEST_V2 as Workflow<DigestV2Params>).create({
          id: `digest-v2-${key}`,
          params: { date, edition, mode: EDITION.mode },
        }),
    ],
  ]
  if (EDITION.mode !== "send") {
    runs.push([
      `digest-${key}`,
      () => (env.DIGEST as Workflow<DigestParams>).create({ id: `digest-${key}`, params: { date, edition } }),
    ])
  }
  for (const [id, create] of runs) {
    try {
      await create()
    } catch (e) {
      // The instance ID is per edition, so a duplicate cron fire fails here; the DB claim covers the rest.
      console.warn(JSON.stringify({ event: "digest_create_failed", id, error: String(e) }))
    }
  }
}

/** sendBatch caps at 100 messages. */
const enqueueArticles = async (queue: Queue<ProcessMessage | IngestMessage>, ids: number[]) => {
  for (let i = 0; i < ids.length; i += 100) {
    await queue.sendBatch(ids.slice(i, i + 100).map((articleId) => ({ body: { articleId } })))
  }
}

export default {
  async scheduled(controller, env) {
    switch (controller.cron) {
      case "* * * * *": {
        const db = getDb(env.DB)
        await scheduleDueSources(db, env.FETCH_Q as Queue<FetchMessage>, controller.scheduledTime)
        // A full ingest run wakes the next itself; this only restarts a drain that stalled (a cap, a failure).
        const minute = new Date(controller.scheduledTime).getUTCMinutes()
        if (minute % FACETS.stallCheckMinutes === 0 && (await ingestBacklog(db)) > 0) {
          await (env.FACET_Q as Queue<IngestMessage>).send({ articleId: 0 })
        }
        break
      }
      case "0 * * * *": {
        const db = getDb(env.DB)
        await runHourly(env, db, llmFor(env, db), controller.scheduledTime)
        break
      }
      // DIGEST.editions holds the same hours.
      case "0 6 * * *":
        await startDigest(env, controller.scheduledTime, "morning")
        break
      case "0 15 * * *":
        await startDigest(env, controller.scheduledTime, "afternoon")
        break
      case "30 3 * * *": {
        const db = getDb(env.DB)
        await runMaintenance(db, llmFor(env, db), env.PROCESS_Q as Queue<ProcessMessage>, controller.scheduledTime)
        break
      }
      default:
        console.warn(`unknown cron ${controller.cron}`)
    }
  },

  async queue(batch, env) {
    const db = getDb(env.DB)
    switch (batch.queue) {
      case "fetch-q":
        for (const msg of batch.messages as readonly Message<FetchMessage>[]) {
          try {
            const newIds = await fetchSource(db, msg.body.sourceId)
            await enqueueArticles(env.FACET_Q as Queue<IngestMessage>, newIds)
            msg.ack()
          } catch (e) {
            console.error(JSON.stringify({ event: "fetch_failed", sourceId: msg.body.sourceId, error: String(e) }))
            msg.retry()
          }
        }
        break
      case "process-q": {
        const ids = (batch.messages as readonly Message<ProcessMessage>[]).map((m) => m.body.articleId)
        try {
          await processArticles(
            { AI: env.AI, VECTORS: env.VECTORS, STORY_EVAL: env.STORY_EVAL as Workflow<StoryEvalParams> },
            db,
            llmFor(env, db),
            ids,
          )
          batch.ackAll()
        } catch (e) {
          // Articles already assigned are skipped on the retry, so one failure doesn't redo the batch.
          console.error(JSON.stringify({ event: "process_failed", count: ids.length, error: String(e) }))
          batch.retryAll()
        }
        break
      }
      case "facet-q":
        try {
          const counts = await ingestArticles({ AI: env.AI, GISTS: env.GISTS }, db, llmFor(env, db), Date.now())
          console.log(JSON.stringify({ event: "ingest", ...counts }))
          // A full page means more are waiting: chain the next run instead of waiting for the stall check.
          if (counts.more) await (env.FACET_Q as Queue<IngestMessage>).send({ articleId: 0 })
          batch.ackAll()
        } catch (e) {
          // Placed articles are not taken again, so a retry carries on where the failure stopped.
          console.error(JSON.stringify({ event: "ingest_failed", error: String(e) }))
          batch.retryAll({ delaySeconds: 60 })
        }
        break
      default:
        console.warn(`unknown queue ${batch.queue}`)
        batch.ackAll()
    }
  },
} satisfies ExportedHandler<Env>
