import { articleSetHash, countryName, EDITION, eventCounters } from "@digest/core"
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
import { type EventCopy, type Llm, LlmRefusal, SpendCapError, writeCopy } from "@digest/llm"
import { pickLinks, renderDigestItem } from "@digest/telegram"
import { log } from "./util.ts"

export type EventItem = { text: string; headline: string; threadId: number | null; origins: number }

/** Distinct values, newest first and origins before copies, at most EDITION.copyReports. */
const reports = (own: EventMember[], pick: (m: EventMember) => string) => {
  const newest = own.toSorted((a, b) => b.publishedAt - a.publishedAt)
  const origins = newest.filter((m) => m.originArticleId === null)
  return [...new Set([...origins, ...newest].map(pick))].slice(0, EDITION.copyReports)
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Digest items for events as of `asOf`, rendered for Telegram. Copy is reused while `events.copy_hash` matches the
 * member article set; the stale ones get one Sonnet call between them, and without an LLM, or capped or refused, the
 * item falls back to the lead report's title and gist. New copy is stored on the event only with `persist` (a replay
 * leaves the live copy alone). Sonnet sees the newest reports first, so the copy follows the latest development. The
 * tag is code's: the primary thread when it is active, else the first countries, else the event type. Links are origin
 * members, official sources first.
 */
export const buildEventItems = async (
  db: Db,
  llm: Llm | null,
  profile: Profile,
  eventIds: number[],
  asOf: number,
  o: { persist: boolean },
): Promise<Map<number, EventItem>> => {
  const [members, stored, threads] = await Promise.all([
    eventMembers(db, eventIds, asOf),
    eventCopyRows(db, eventIds),
    eventThreadLinks(db, eventIds),
  ])
  const byId = byEvent(members)
  const events = eventIds.flatMap((id) => {
    const own = byId.get(id) ?? []
    const counters = eventCounters(own)
    return counters ? [{ id, own, counters, hash: articleSetHash(own.map((m) => m.articleId)) }] : []
  })

  const copy = new Map<number, EventCopy>()
  for (const e of events) {
    const row = stored.get(e.id)
    if (row?.copyHash !== e.hash || !row.headline || !row.summary) continue
    copy.set(e.id, { headline: row.headline, summary: row.summary })
  }
  const stale = events.filter((e) => !copy.has(e.id))
  if (llm && stale.length > 0) {
    try {
      const written = await writeCopy(
        llm,
        profile,
        stale.map((e) => ({
          id: e.id,
          titles: reports(e.own, (m) => m.titleEn),
          gists: reports(e.own, (m) => m.gist),
        })),
      )
      if (o.persist) {
        const hashes = new Map(stale.map((e) => [e.id, e.hash]))
        await runBatch(
          db,
          [...written].map(([id, c]) => updateEvent(db, id, { ...c, copyHash: hashes.get(id) ?? null })),
        )
      }
      for (const [id, c] of written) copy.set(id, c)
    } catch (e) {
      if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
      log("edition_copy_skipped", { error: String(e) })
    }
  }

  const out = new Map<number, EventItem>()
  for (const { id, own, counters } of events) {
    const c = copy.get(id) ?? { headline: counters.title, summary: counters.gist }
    const thread = threads.get(id)?.[0]
    const countries = counters.countriesJson.slice(0, EDITION.tagCountries).map(countryName)
    const tag =
      thread?.status === "active"
        ? thread.name
        : countries.length
          ? countries.join(" and ")
          : sentenceCase(counters.eventType)
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
    const item = {
      tag,
      headline: c.headline,
      summary: c.summary,
      origins: counters.independentOrigins,
      links,
      isUpdate: false,
    }
    out.set(id, {
      text: renderDigestItem(item),
      headline: c.headline,
      threadId: thread?.threadId ?? null,
      origins: counters.independentOrigins,
    })
  }
  return out
}
