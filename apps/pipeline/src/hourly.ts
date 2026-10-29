import type { Db } from "@digest/db"
import { momentumStep } from "./hourly/momentum.ts"
import { rollupStep } from "./hourly/rollups.ts"
import type { llmFor } from "./llm.ts"

type Step = { name: string; run: () => Promise<Record<string, number>> }

/** Hourly loop at minute 0. Steps run in order; one failing is logged and the rest still run. */
export const runHourly = async (_env: Env, db: Db, _llm: ReturnType<typeof llmFor>, now: number) => {
  const steps: Step[] = [
    { name: "rollups", run: () => rollupStep(db, now) },
    { name: "momentum", run: () => momentumStep(db, now) },
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
