import { articleSetHash, countryName, EDITION, eventCounters, reports } from "@digest/core"
import {
  byEvent,
  type Db,
  type EventMember,
  eventCopyRows,
  eventMembers,
  eventThreadLinks,
  type Profile,
  runBatch,
  updateEvent,
} from "@digest/db"
import { type ItemCopy, type Llm, LlmRefusal, SpendCapError, writeCopy } from "@digest/llm"
import { pickLinks, renderDigestItem } from "@digest/telegram"
import { log } from "./util.ts"

/** What an item is built from: its lead and the other events it carries, its story and the reader's last brief. */
export type ItemGroup = {
  leadId: number
  carriers: number[]
  story: { id: number; name: string; description: string } | null
  lastBrief: { headline: string; summary: string; at: number } | null
}

export type StoryItem = {
  text: string
  headline: string
  summary: string
  threadId: number | null
  origins: number
  isUpdate: boolean
  /** The copy found only talk, or nothing new since the last brief. */
  skip: boolean
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Members of several events once each, earliest published first, as eventCounters reads them. */
const union = (lists: EventMember[][]) => {
  const seen = new Set<number>()
  return lists
    .flat()
    .filter((m) => !seen.has(m.articleId) && seen.add(m.articleId))
    .sort((a, b) => a.publishedAt - b.publishedAt || a.articleId - b.articleId)
}

/**
 * Digest items for groups as of `asOf`, by lead id, rendered for Telegram, from the union of the carriers' members.
 * Copy is reused while the lead's `copy_hash` matches that member set and the last brief; the stale ones get one
 * Sonnet call between them, which sees the story and the last brief, writes only what changed, and may skip an item
 * as talk. Without an LLM, or capped or refused, an item falls back to the lead's title and gist. New copy is stored
 * on the lead only with `persist`, so reader pages show it (a replay leaves the live copy alone). The tag is code's:
 * the story, else the active primary thread, else the first countries, else the event type. Links are origin
 * members, official sources first.
 */
export const buildStoryItems = async (
  db: Db,
  llm: Llm | null,
  profile: Profile,
  groups: ItemGroup[],
  asOf: number,
  o: { persist: boolean },
): Promise<Map<number, StoryItem>> => {
  const ids = [...new Set(groups.flatMap((g) => [g.leadId, ...g.carriers]))]
  const leads = groups.map((g) => g.leadId)
  const [members, stored, threads] = await Promise.all([
    eventMembers(db, ids, asOf),
    eventCopyRows(db, leads),
    eventThreadLinks(db, leads),
  ])
  const byId = byEvent(members)
  const built = groups.flatMap((g) => {
    const own = union([g.leadId, ...g.carriers].map((id) => byId.get(id) ?? []))
    const lead = eventCounters(byId.get(g.leadId) ?? [])
    const counters = eventCounters(own)
    if (!lead || !counters) return []
    const hash = `${articleSetHash(own.map((m) => m.articleId))}${g.lastBrief ? `-b${g.lastBrief.at}` : ""}`
    return [{ g, own, lead, counters, hash }]
  })

  const copy = new Map<number, ItemCopy>()
  for (const b of built) {
    const row = stored.get(b.g.leadId)
    if (row?.copyHash !== b.hash || !row.headline || !row.summary) continue
    copy.set(b.g.leadId, { headline: row.headline, summary: row.summary, skip: false })
  }
  const stale = built.filter((b) => !copy.has(b.g.leadId))
  if (llm && stale.length > 0) {
    try {
      const written = await writeCopy(
        llm,
        profile,
        stale.map((b) => ({
          id: b.g.leadId,
          titles: reports(b.own, (m) => m.titleEn, EDITION.copyReports),
          gists: reports(b.own, (m) => m.gist, EDITION.copyReports),
          story: b.g.story && { name: b.g.story.name, description: b.g.story.description },
          lastBrief: b.g.lastBrief,
        })),
      )
      if (o.persist) {
        const hashes = new Map(stale.map((b) => [b.g.leadId, b.hash]))
        await runBatch(
          db,
          [...written]
            .filter(([, c]) => !c.skip)
            .map(([id, c]) =>
              updateEvent(db, id, { headline: c.headline, summary: c.summary, copyHash: hashes.get(id) ?? null }),
            ),
        )
      }
      for (const [id, c] of written) copy.set(id, c)
    } catch (e) {
      if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
      log("edition_copy_skipped", { error: String(e) })
    }
  }

  const out = new Map<number, StoryItem>()
  for (const { g, own, lead, counters } of built) {
    const c = copy.get(g.leadId) ?? { headline: lead.title, summary: lead.gist, skip: false }
    const thread = threads.get(g.leadId)?.[0]
    const countries = counters.countriesJson.slice(0, EDITION.tagCountries).map(countryName)
    const tag =
      g.story?.name ??
      (thread?.status === "active"
        ? thread.name
        : countries.length
          ? countries.join(" and ")
          : sentenceCase(counters.eventType))
    const links = pickLinks(
      own.map((m) => ({
        originId: m.originArticleId,
        official: m.sourceRole === "official",
        authoritative: false,
        tier: m.tier,
        publishedAt: m.publishedAt,
        domain: m.domain,
        canonicalUrl: m.canonicalUrl,
        sourceName: m.sourceName,
      })),
    )
    const isUpdate = g.lastBrief !== null
    out.set(g.leadId, {
      text: renderDigestItem({
        tag,
        headline: c.headline,
        summary: c.summary,
        origins: counters.independentOrigins,
        links,
        isUpdate,
      }),
      headline: c.headline,
      summary: c.summary,
      threadId: thread?.threadId ?? null,
      origins: counters.independentOrigins,
      isUpdate,
      skip: c.skip,
    })
  }
  return out
}
