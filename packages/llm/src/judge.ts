import { sanitizeUserText } from "@digest/core"
import { STORY_CHANGES, type StoryChange } from "@digest/db"
import { z } from "zod"
import type { Llm } from "./client.ts"
import { MODELS } from "./models.ts"
import { attrText, DATA_RULE, PLAIN, tagText } from "./prompt.ts"

export type JudgeEvent = {
  id: number
  title: string
  gist: string
  act: string
  material: boolean
  significance: number
}

export type JudgeStory = {
  id: number
  name: string
  description: string
  /** The reader's last item on the story and its age in days; null when the reader never got one. */
  lastBrief: { headline: string; summary: string; ageDays: number } | null
  events: JudgeEvent[]
}

export type StoryJudgment = { storyId: number; change: StoryChange; carriers: number[]; reason: string }

const storyBlock = (s: JudgeStory) => `<story id="${s.id}">
<name>${tagText(s.name)}</name>
<description>${tagText(s.description)}</description>
${
  s.lastBrief
    ? `<last_brief age_days="${s.lastBrief.ageDays}">${tagText(s.lastBrief.headline)}. ${tagText(s.lastBrief.summary)}</last_brief>`
    : "<last_brief>never</last_brief>"
}
${s.events
  .map(
    (
      e,
    ) => `<event id="${e.id}" act="${attrText(e.act)}" material="${e.material ? "yes" : "no"}" significance="${e.significance}">
<title>${tagText(e.title)}</title>
<gist>${tagText(e.gist)}</gist>
</event>`,
  )
  .join("\n")}
</story>`

const SYSTEM = `You keep a news digest from repeating itself. The digest gives each running story, a matter that lasts months or years, at most one item per edition, and only when the story's situation changed since the reader's last item on it. For each story you get what the reader was last told, and the coded events since.

${DATA_RULE}

For every story decide change:
none: the story's usual activity, more of the same however grave, new details, reactions, or only talk: statements, threats, warnings, plans, proposals, demands, claims, predictions, analysis, talks announced or said to go well.
minor: a real development, but the story stands where the last brief left it.
major: the story began, ended, escalated or de-escalated sharply, changed in scale or nature, drew in a new party, or a decision, agreement, ruling or outcome took effect that settles part of what it is about.
Judge against the last brief, what the reader already knows. When the reader never got one, judge against the description: the newest events must change the situation it describes, not continue it. A story that began within these events is major.

carriers: the ids of the events that make up the change, the most important first; empty when change is none.
reason: one line of at most 15 words on what changed, or why nothing did. Never write URLs, outlet or publisher names or timestamps. ${PLAIN}`

const JudgeOut = z.object({
  judgments: z.array(
    z.object({
      storyId: z.number().int(),
      change: z.enum(STORY_CHANGES),
      carriers: z.array(z.number().int()),
      reason: z.string(),
    }),
  ),
})

/** Haiku judges each story's change since its last brief; unknown stories and carriers are dropped. */
export const judgeChanges = async (llm: Llm, stories: JudgeStory[]) => {
  if (stories.length === 0) return [] as StoryJudgment[]
  const { judgments } = await llm.structured({
    purpose: "edition_change",
    model: MODELS.haiku,
    system: SYSTEM,
    cacheSystem: true,
    prompt: `${stories.map(storyBlock).join("\n\n")}\n\nJudge every story by its id.`,
    schema: JudgeOut,
    maxTokens: 512 + 120 * stories.length,
    effort: "medium",
  })
  const offered = new Map(stories.map((s) => [s.id, new Set(s.events.map((e) => e.id))]))
  const out = new Map<number, StoryJudgment>()
  for (const j of judgments) {
    const events = offered.get(j.storyId)
    if (!events || out.has(j.storyId)) continue
    out.set(j.storyId, {
      storyId: j.storyId,
      change: j.change,
      carriers: [...new Set(j.carriers.filter((id) => events.has(id)))],
      reason: sanitizeUserText(j.reason),
    })
  }
  return [...out.values()]
}
