import { type Edition, editionKey } from "@digest/core"
import { getDb } from "@digest/db"
import type { DigestParams } from "./digest.ts"
import { type FetchMessage, fetchSource } from "./fetch.ts"
import { runHourly } from "./hourly.ts"
import { llmFor } from "./llm.ts"
import { runMaintenance } from "./maintenance.ts"
import { type ProcessMessage, processArticles } from "./process.ts"
import { scheduleDueSources } from "./scheduler.ts"
import type { StoryEvalParams } from "./story-eval.ts"

export { Digest } from "./digest.ts"
export { StoryEval } from "./story-eval.ts"

const startDigest = async (workflow: Workflow<DigestParams>, scheduledTime: number, edition: Edition) => {
  const date = new Date(scheduledTime).toISOString().slice(0, 10)
  const key = editionKey(date, edition)
  try {
    await workflow.create({ id: `digest-${key}`, params: { date, edition } })
  } catch (e) {
    // The instance ID is per edition, so a duplicate cron fire fails here; the DB claim covers the rest.
    console.warn(JSON.stringify({ event: "digest_create_failed", key, error: String(e) }))
  }
}

/** sendBatch caps at 100 messages. */
const enqueueArticles = async (queue: Queue<ProcessMessage>, ids: number[]) => {
  for (let i = 0; i < ids.length; i += 100) {
    await queue.sendBatch(ids.slice(i, i + 100).map((articleId) => ({ body: { articleId } })))
  }
}

export default {
  async scheduled(controller, env) {
    switch (controller.cron) {
      case "* * * * *":
        await scheduleDueSources(getDb(env.DB), env.FETCH_Q as Queue<FetchMessage>, controller.scheduledTime)
        break
      case "0 * * * *": {
        const db = getDb(env.DB)
        await runHourly(env, db, llmFor(env, db), controller.scheduledTime)
        break
      }
      // DIGEST.editions holds the same hours.
      case "0 6 * * *":
        await startDigest(env.DIGEST as Workflow<DigestParams>, controller.scheduledTime, "morning")
        break
      case "0 15 * * *":
        await startDigest(env.DIGEST as Workflow<DigestParams>, controller.scheduledTime, "afternoon")
        break
      case "30 3 * * *":
        await runMaintenance(getDb(env.DB), env.PROCESS_Q as Queue<ProcessMessage>, controller.scheduledTime)
        break
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
            await enqueueArticles(env.PROCESS_Q as Queue<ProcessMessage>, newIds)
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
      default:
        console.warn(`unknown queue ${batch.queue}`)
        batch.ackAll()
    }
  },
} satisfies ExportedHandler<Env>
