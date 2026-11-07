import type { Db } from "@digest/db"
import { alertsStep } from "./alerts.ts"
import { consolidateStep } from "./hourly/consolidate.ts"
import { momentumStep } from "./hourly/momentum.ts"
import { moversStep } from "./hourly/movers.ts"
import { rollupStep } from "./hourly/rollups.ts"
import { storiesStep } from "./hourly/stories.ts"
import { threadsStep } from "./hourly/threads.ts"
import type { llmFor } from "./llm.ts"
import { relevanceStep } from "./relevance.ts"

type Step = { name: string; run: () => Promise<Record<string, number | undefined>> }

/** Hourly loop at minute 0. Steps run in order; one failing is logged and the rest still run. */
export const runHourly = async (env: Env, db: Db, llm: ReturnType<typeof llmFor>, now: number) => {
  const steps: Step[] = [
    // Fold duplicate events before threads and rollups read event ids.
    { name: "consolidate", run: () => consolidateStep({ GISTS: env.GISTS }, db, llm, now) },
    { name: "threads", run: () => threadsStep(db, llm, now) },
    { name: "stories", run: () => storiesStep(db, llm, now) },
    { name: "rollups", run: () => rollupStep(db, now) },
    { name: "momentum", run: () => momentumStep(db, now) },
    { name: "relevance", run: () => relevanceStep(db, llm, now) },
    { name: "movers", run: () => moversStep(db, llm, now) },
    { name: "alerts", run: () => alertsStep(env, db, llm, now) },
  ]
  for (const step of steps) {
    const started = Date.now()
    try {
      const counts = await step.run()
      console.log(JSON.stringify({ event: "hourly", step: step.name, ms: Date.now() - started, ...counts }))
    } catch (e) {
      console.error(JSON.stringify({ event: "hourly_failed", step: step.name, error: String(e) }))
    }
  }
}
