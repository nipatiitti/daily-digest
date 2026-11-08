import { sanitizeUserText } from "@digest/core"
import type { Profile } from "@digest/db"
import { z } from "zod"
import type { Llm } from "./client.ts"
import { MODELS } from "./models.ts"
import { DATA_RULE, profileText, tagText, WRITING_RULE } from "./prompt.ts"

export type CopyItem = {
  /** The item's lead event. */
  id: number
  titles: string[]
  gists: string[]
  story: { name: string; description: string } | null
  /** What the reader was last told about the story; null when never. */
  lastBrief: { headline: string; summary: string } | null
}
export type ItemCopy = { headline: string; summary: string; skip: boolean }

const copyBlock = (e: CopyItem) => `<item id="${e.id}">
${e.story ? `<story>${tagText(e.story.name)}: ${tagText(e.story.description)}</story>\n` : ""}${
  e.lastBrief ? `<last_brief>${tagText(e.lastBrief.headline)}. ${tagText(e.lastBrief.summary)}</last_brief>\n` : ""
}${e.titles.map((t) => `<title>${tagText(t)}</title>`).join("\n")}
${e.gists.map((g) => `<gist>${tagText(g)}</gist>`).join("\n")}
</item>`

const COPY = `You write the copy for one edition of a reader's personal news digest. Each item comes with the titles and gists of its reports, newest first. An item that is part of a running story names it, and when the reader got an item on that story before, last_brief is what they were told.

${DATA_RULE}

For every item write:
headline: at most 12 words, sentence case, no trailing full stop.
summary: exactly one sentence of at most 30 words with the concrete facts: who, what, where and the numbers that matter.
Both describe the latest development the newest reports give, not how the story began. With a last_brief, write only what changed since it; never repeat what it already said. Never explain why the item matters or why the reader gets it; the reader can judge that.
skip: true only when the reports describe no new event at all: nothing changed since the last_brief, or there is only talk, such as statements, threats, warnings, plans, proposals, claims, predictions, analysis or opinion, talks announced or said to go well. An action, decision, appointment, result, release, disclosure, attack or accident is never skipped, however small, and never skip for importance or for the reader's interests: other steps judged those. Still write the copy. Otherwise false.
Write only what the reports say. ${WRITING_RULE}`

const CopyOut = z.object({
  items: z.array(z.object({ id: z.number().int(), headline: z.string(), summary: z.string(), skip: z.boolean() })),
})

/** One Sonnet call writes the headline and summary for every item, and may skip one as talk; ids not asked are dropped. */
export const writeCopy = async (llm: Llm, profile: Profile, items: CopyItem[]) => {
  const copy = new Map<number, ItemCopy>()
  if (items.length === 0) return copy
  const { items: out } = await llm.structured({
    purpose: "edition_copy",
    model: MODELS.sonnet,
    system: `${COPY}\n\n${profileText(profile)}`,
    prompt: `${items.map(copyBlock).join("\n\n")}\n\nWrite the copy for every item by its id.`,
    schema: CopyOut,
    maxTokens: 512 + 160 * items.length,
    effort: "medium",
  })
  const asked = new Set(items.map((e) => e.id))
  for (const i of out) {
    if (!asked.has(i.id) || copy.has(i.id)) continue
    copy.set(i.id, {
      headline: sanitizeUserText(i.headline).replace(/\.$/, ""),
      summary: sanitizeUserText(i.summary),
      skip: i.skip,
    })
  }
  return copy
}
