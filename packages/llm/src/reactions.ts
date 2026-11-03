import { isCountry, REACTIONS, sanitizeUserText } from "@digest/core"
import type { Profile, ProfileEdit } from "@digest/db"
import { z } from "zod"
import type { Llm } from "./client.ts"
import { MODELS } from "./models.ts"
import { tagText } from "./prompt.ts"
import { countryList, DATA_RULE, profileText, WRITING_RULE } from "./relevance.ts"

export type VoteInput = {
  feedbackId: number
  vote: "up" | "down"
  headline: string
  summary: string | null
  threadName: string | null
  countries: string[]
  sourceRoles: string[]
}

const voteBlock = (v: VoteInput) => `<vote vote="${v.vote}">
<headline>${tagText(v.headline)}</headline>
<summary>${tagText(v.summary ?? "")}</summary>
<thread>${tagText(v.threadName ?? "none")}</thread>
<countries>${countryList(v.countries)}</countries>
<source_roles>${tagText(v.sourceRoles.join(", "))}</source_roles>
</vote>`

const SYSTEM = `You tune a reader's news profile from the reader's votes on digest items. An up vote means the reader wanted more like it, a down vote less.

${DATA_RULE}

Propose at most ${REACTIONS.maxEdits} edits, and only where a pattern holds across at least two votes; a single vote is never enough.
set_topic adds a topic or changes its weight: 1 a passing interest, 2 a clear one, 3 a core one. remove_topic drops a topic by its exact name.
add_mute and remove_mute take a short plain description of what is never worth sending, such as "single-vendor advisories unless exploited at scale".
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
