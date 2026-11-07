import { sanitizeUserText } from "@digest/core"
import type { Profile } from "@digest/db"
import { z } from "zod"
import type { Llm } from "./client.ts"
import { MODELS } from "./models.ts"
import { tagText } from "./prompt.ts"
import { countryList, DATA_RULE, profileText, WRITING_RULE } from "./relevance.ts"

export type InterestEvent = {
  id: number
  title: string
  gist: string
  countries: string[]
  eventType: string
  threadName: string | null
  entities: string[]
}

const eventBlock = (e: InterestEvent) => `<event id="${e.id}">
<title>${tagText(e.title)}</title>
<gist>${tagText(e.gist)}</gist>
<type>${tagText(e.eventType)}</type>
<countries>${countryList(e.countries)}</countries>
<thread>${tagText(e.threadName ?? "none")}</thread>
<entities>${tagText(e.entities.join(", ")) || "none"}</entities>
</event>`

const system = (
  p: Profile,
) => `You mark which news events match one reader's own niche interests, for a personal digest.

Another step already judges how significant each event is in the world and brings the significant ones whatever the reader's interests. Your mark only lifts smaller events the reader cares about, so the digest also brings those. Never judge importance and never lower an event: an event outside the reader's interests is level 0, which is neutral.

${DATA_RULE}

For every event give:
level: 0 to 3.
3: squarely what one of the reader's core interests is about.
2: squarely a clear interest, or the own affairs of one of the reader's regions.
1: squarely a passing interest, or a looser fit with a clear or core interest.
0: none of the reader's topics or regions.
A region counts when the event is that region's own affairs: what happened there or to it, not a report from an outlet there or a passing mention.
muted: true only when one of the reader's mutes describes the event. Otherwise false, whatever its level.
reason: one line of at most 12 words naming the topic, region or mute that matched; "none" when level is 0 and it is not muted. ${WRITING_RULE}

${profileText(p)}`

const InterestOut = z.object({
  marks: z.array(z.object({ id: z.number().int(), level: z.number(), muted: z.boolean(), reason: z.string() })),
})

/** Haiku marks every event's interest 0 to 3 against the profile, and whether a mute describes it. */
export const scoreInterest = async (llm: Llm, profile: Profile, events: InterestEvent[]) => {
  if (events.length === 0) return { marks: [], callId: null }
  const { value, callId } = await llm.structuredCall({
    purpose: "interest",
    model: MODELS.haiku,
    system: system(profile),
    cacheSystem: true,
    prompt: `${events.map(eventBlock).join("\n\n")}\n\nMark every event by its id.`,
    schema: InterestOut,
    eventId: events[0]?.id,
    maxTokens: 512 + 64 * events.length,
    effort: "low",
  })
  const offered = new Set(events.map((e) => e.id))
  const marks = new Map<number, { eventId: number; level: number; muted: boolean; reason: string }>()
  for (const m of value.marks) {
    if (!offered.has(m.id) || marks.has(m.id)) continue
    const level = Math.round(Math.min(3, Math.max(0, m.level)))
    marks.set(m.id, { eventId: m.id, level, muted: m.muted, reason: sanitizeUserText(m.reason) })
  }
  return { marks: [...marks.values()], callId }
}
