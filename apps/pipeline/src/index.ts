import { getDb } from "@digest/db"
import type { DigestParams } from "./digest.ts"
import { type FetchMessage, fetchSource } from "./fetch.ts"
import { scheduleDueSources } from "./scheduler.ts"

export { Digest } from "./digest.ts"

const startDigest = async (workflow: Workflow<DigestParams>, scheduledTime: number) => {
  const date = new Date(scheduledTime).toISOString().slice(0, 10)
  try {
    await workflow.create({ id: `digest-${date}`, params: { date } })
  } catch (e) {
    // The instance ID is per day, so a duplicate cron fire fails here; the DB claim covers the rest.
    console.warn(JSON.stringify({ event: "digest_create_failed", date, error: String(e) }))
  }
}

export default {
  async scheduled(controller, env) {
    switch (controller.cron) {
      case "* * * * *":
        await scheduleDueSources(getDb(env.DB), env.FETCH_Q as Queue<FetchMessage>, controller.scheduledTime)
        break
      case "0 7 * * *":
        await startDigest(env.DIGEST as Workflow<DigestParams>, controller.scheduledTime)
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
            await fetchSource(db, msg.body.sourceId)
            msg.ack()
          } catch (e) {
            console.error(JSON.stringify({ event: "fetch_failed", sourceId: msg.body.sourceId, error: String(e) }))
            msg.retry()
          }
        }
        break
      default:
        console.warn(`unknown queue ${batch.queue}`)
        batch.ackAll()
    }
  },
} satisfies ExportedHandler<Env>
