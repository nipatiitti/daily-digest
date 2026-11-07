import { type Edition, editionKey, FACETS } from "@digest/core"
import { getDb } from "@digest/db"
import type { DigestV2Params } from "./digest-v2.ts"
import { type FetchMessage, fetchSource } from "./fetch.ts"
import { runHourly } from "./hourly.ts"
import { type IngestMessage, ingestArticles, ingestBacklog } from "./ingest.ts"
import { llmFor } from "./llm.ts"
import { runMaintenance } from "./maintenance.ts"
import { scheduleDueSources } from "./scheduler.ts"

export { DigestV2 } from "./digest-v2.ts"

/** One digest-v2 instance per edition; its ID makes a duplicate cron fire fail here, and the DB claim covers the rest. */
const startDigest = async (env: Env, scheduledTime: number, edition: Edition) => {
  const date = new Date(scheduledTime).toISOString().slice(0, 10)
  const id = `digest-v2-${editionKey(date, edition)}`
  try {
    await (env.DIGEST_V2 as Workflow<DigestV2Params>).create({ id, params: { date, edition, mode: "send" } })
  } catch (e) {
    console.warn(JSON.stringify({ event: "digest_create_failed", id, error: String(e) }))
  }
}

/** sendBatch caps at 100 messages. */
const enqueueArticles = async (queue: Queue<IngestMessage>, ids: number[]) => {
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
      // Twenty past, so the hourly threads, stories, coding and interest have run on the hour's events.
      case "20 6 * * *":
        await startDigest(env, controller.scheduledTime, "morning")
        break
      case "20 15 * * *":
        await startDigest(env, controller.scheduledTime, "afternoon")
        break
      case "30 3 * * *": {
        const db = getDb(env.DB)
        await runMaintenance(db, llmFor(env, db), controller.scheduledTime)
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
