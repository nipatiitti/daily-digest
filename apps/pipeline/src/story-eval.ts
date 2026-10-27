import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"

export type StoryEvalParams = {
  storyId: number
  /** Hash of the story's article set when the run was started; the instance ID carries it too. */
  hash: string
}

/**
 * Per-story evaluation. Stub: the real stages (full text, Sonnet extraction and rubric, CVE
 * enrichment, score, alert and update gates, send) come next. For now it only records that a
 * story crossed the evidence bar, so the gate log shows what would have been evaluated.
 */
export class StoryEval extends WorkflowEntrypoint<Env, StoryEvalParams> {
  override async run(event: WorkflowEvent<StoryEvalParams>, step: WorkflowStep) {
    const { storyId, hash } = event.payload
    await step.do("stub", async () => {
      console.log(JSON.stringify({ event: "story_eval_stub", storyId, hash }))
    })
    return { storyId, hash, evaluated: false }
  }
}
