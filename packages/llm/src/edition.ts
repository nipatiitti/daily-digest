import { sanitizeUserText } from "@digest/core"
import type { Profile } from "@digest/db"
import { z } from "zod"
import type { Llm } from "./client.ts"
import { MODELS } from "./models.ts"
import { tagText } from "./prompt.ts"
import { countryList, DATA_RULE, profileText, WRITING_RULE } from "./relevance.ts"

export type CutCandidate = {
  id: number
  title: string
  gist: string
  threadName: string | null
  countries: string[]
  sources: string[]
  relevance: number
  reason: string
  cooledThread: { lastSentHeadline: string } | null
}

const candidateBlock = (c: CutCandidate) => `<candidate id="${c.id}">
<title>${tagText(c.title)}</title>
<gist>${tagText(c.gist)}</gist>
<thread>${tagText(c.threadName ?? "none")}</thread>
<countries>${countryList(c.countries)}</countries>
<sources>${tagText(c.sources.join(", "))}</sources>
<relevance>${c.relevance}</relevance>
<reason>${tagText(c.reason)}</reason>${c.cooledThread ? `\n<sent_last_time>${tagText(c.cooledThread.lastSentHeadline)}</sent_last_time>` : ""}
</candidate>`

const CUT = `You make the final cut for one edition of a reader's personal news digest. The candidates come ranked by relevance to the reader's profile.

${DATA_RULE}

Pick the items for the edition and return their ids in reading order, the most important first:
Never pick two candidates about the same event; keep the one with the better title and gist.
Spread the edition across threads, countries and sources; do not fill it with one development.
A candidate with sent_last_time belongs to a thread the reader got in a recent edition. Keep it only when the development materially moved since that headline, not when it repeats or adds detail.
Return at least the minimum and at most the maximum asked, but return fewer than the minimum rather than pad the edition with weak items.`

const CutOut = z.object({ ids: z.array(z.number().int()) })

/** Haiku picks the edition from the ranked candidates, in reading order; unknown and repeated ids are dropped. */
export const finalCut = async (
  llm: Llm,
  profile: Profile,
  candidates: CutCandidate[],
  o: { min: number; max: number },
) => {
  if (candidates.length === 0) return { ids: [], callId: null }
  const { value, callId } = await llm.structuredCall({
    purpose: "edition_cut",
    model: MODELS.haiku,
    system: `${CUT}\n\n${profileText(profile)}`,
    prompt: `${candidates.map(candidateBlock).join("\n\n")}\n\nPick between ${o.min} and ${o.max} items.`,
    schema: CutOut,
    maxTokens: 1024,
    effort: "medium",
  })
  const offered = new Set(candidates.map((c) => c.id))
  return { ids: [...new Set(value.ids.filter((id) => offered.has(id)))].slice(0, o.max), callId }
}

export type CopyEvent = { id: number; titles: string[]; gists: string[]; reason: string }
export type EventCopy = { headline: string; summary: string; whyForYou: string | null }

const copyBlock = (e: CopyEvent) => `<event id="${e.id}">
${e.titles.map((t) => `<title>${tagText(t)}</title>`).join("\n")}
${e.gists.map((g) => `<gist>${tagText(g)}</gist>`).join("\n")}
<relevance_reason>${tagText(e.reason)}</relevance_reason>
</event>`

const COPY = `You write the copy for one edition of a reader's personal news digest. Each event comes with the titles and gists of the reports on it, and why it is relevant to the reader.

${DATA_RULE}

For every event write:
headline: at most 12 words, sentence case, no trailing full stop.
summary: exactly one sentence of at most 30 words with the concrete facts: who, what, where and the numbers that matter.
whyForYou: a clause of at most 12 words tying the event to the reader's profile, or null when the relevance is obvious from the headline.
Write only what the reports say. ${WRITING_RULE}`

const CopyOut = z.object({
  items: z.array(
    z.object({ id: z.number().int(), headline: z.string(), summary: z.string(), whyForYou: z.string().nullable() }),
  ),
})

/** One Sonnet call writes headline, summary and the optional why clause for every event; ids not asked are dropped. */
export const writeCopy = async (llm: Llm, profile: Profile, events: CopyEvent[]) => {
  const copy = new Map<number, EventCopy>()
  if (events.length === 0) return copy
  const { items } = await llm.structured({
    purpose: "edition_copy",
    model: MODELS.sonnet,
    system: `${COPY}\n\n${profileText(profile)}`,
    prompt: `${events.map(copyBlock).join("\n\n")}\n\nWrite the copy for every event by its id.`,
    schema: CopyOut,
    maxTokens: 512 + 160 * events.length,
    effort: "medium",
  })
  const asked = new Set(events.map((e) => e.id))
  for (const i of items) {
    if (!asked.has(i.id) || copy.has(i.id)) continue
    const why = i.whyForYou === null ? "" : sanitizeUserText(i.whyForYou)
    copy.set(i.id, {
      headline: sanitizeUserText(i.headline).replace(/\.$/, ""),
      summary: sanitizeUserText(i.summary),
      whyForYou: why || null,
    })
  }
  return copy
}
