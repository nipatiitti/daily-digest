import { isCountry, REACTIONS, sanitizeUserText } from "@digest/core"
import type { Profile, ProfileEdit } from "@digest/db"
import { z } from "zod"
import type { Llm } from "./client.ts"
import { MODELS } from "./models.ts"
import { countryList, DATA_RULE, profileText, tagText, WRITING_RULE } from "./prompt.ts"

export type VoteInput = {
  feedbackId: number
  vote: "up" | "down"
  headline: string
  summary: string | null
  threadName: string | null
  storyName: string | null
  countries: string[]
  sourceRoles: string[]
}

const voteBlock = (v: VoteInput) => `<vote vote="${v.vote}">
<headline>${tagText(v.headline)}</headline>
<summary>${tagText(v.summary ?? "")}</summary>
<story>${tagText(v.storyName ?? "none")}</story>
<thread>${tagText(v.threadName ?? "none")}</thread>
<countries>${countryList(v.countries)}</countries>
<source_roles>${tagText(v.sourceRoles.join(", "))}</source_roles>
</vote>`

const SYSTEM = `You tune a reader's news profile from the reader's votes on digest items. An up vote means the reader wanted the item, a down vote that they did not.

The profile only lifts. The digest brings the world's significant news whatever the profile says; the profile's topics, regions and follows lift smaller items the reader cares about so they clear the bar too, and its mutes hold back what the reader never wants. So the profile holds niche interests, never broad ones.

${DATA_RULE}

Propose at most ${REACTIONS.maxEdits} edits, and only where a pattern holds across several votes; a single vote is never enough.
Up votes on smaller items of one kind may add a narrow topic or raise its weight, or add a region.
Down votes never lower or remove a topic, and never remove a region: a down vote on a significant item says nothing about the reader's interests. Only a clear pattern of at least three down votes on one narrow kind of item may add a mute that describes exactly that kind.
set_topic adds a topic or changes its weight: 1 a passing interest, 2 a clear one, 3 a core one. remove_topic drops a topic by its exact name, only when the reader's own up votes show it was replaced by a narrower one.
add_mute and remove_mute take a short plain description of the kind of item never worth sending.
add_region and remove_region take an ISO 3166 country code, or EU.
append_text adds one sentence to the reader's free text.
Never propose follows; the reader sets those.
When no edit is worth making, return no edits.
The rationale is one or two sentences, written to the reader, on which votes suggest the edits. ${WRITING_RULE}`

const value = z.string()
const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_topic"), name: z.string(), weight: z.number().int().min(1).max(3) }),
  z.object({ op: z.literal("remove_topic"), name: z.string() }),
  z.object({ op: z.literal("add_mute"), value }),
  z.object({ op: z.literal("remove_mute"), value }),
  z.object({ op: z.literal("add_region"), value }),
  z.object({ op: z.literal("remove_region"), value }),
  z.object({ op: z.literal("append_text"), value }),
])
const EditsOut = z.object({ edits: z.array(Edit), rationale: z.string() })

const clean = (e: ProfileEdit): ProfileEdit | null => {
  if (e.op === "add_region" || e.op === "remove_region") {
    const code = e.value.trim().toUpperCase()
    return isCountry(code) ? { ...e, value: code } : null
  }
  const text = sanitizeUserText("name" in e ? e.name : e.value)
  if (!text) return null
  return "name" in e ? { ...e, name: text } : { ...e, value: text }
}

/** Haiku turns the votes into at most REACTIONS.maxEdits profile edits with a rationale; null when none is worth it. */
export const proposeProfileEdits = async (llm: Llm, profile: Profile, votes: VoteInput[]) => {
  const { value: out, callId } = await llm.structuredCall({
    purpose: "reactions",
    model: MODELS.haiku,
    system: `${SYSTEM}\n\n${profileText(profile)}`,
    prompt: `${votes.map(voteBlock).join("\n\n")}\n\nWhich profile edits do these votes support?`,
    schema: EditsOut,
    maxTokens: 1024,
    effort: "medium",
  })
  const edits = out.edits.flatMap((e) => clean(e) ?? []).slice(0, REACTIONS.maxEdits)
  return edits.length ? { edits, rationale: sanitizeUserText(out.rationale), callId } : null
}
