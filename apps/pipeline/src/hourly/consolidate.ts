import { CLUSTER, CONSOLIDATE, cosine, HOUR_MS, titleJaccard, weightedMean } from "@digest/core"
import {
  articleEvents,
  type Db,
  type EventRow,
  eventMembers,
  eventRows,
  lastRun,
  markRun,
  mergeEvents,
  pairDecisionsAmong,
  recentEvents,
  repointMergedArticles,
  savePairDecision,
} from "@digest/db"
import { type EventBrief, type Llm, LlmRefusal, MODELS, SpendCapError, sameEvent } from "@digest/llm"
import { refreshEvents } from "../ingest.ts"
import { inGroups, log } from "../util.ts"

const STEP = "consolidate"

/** Vectorize lookups in flight at once; a Worker keeps at most six connections open. */
const PARALLEL = 6

type Pair = { a: number; b: number; cosine: number; copy: boolean }

const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`

/** Articles ingest placed in an event while it was being merged away move to the event it went into, recounted. */
const repoint = async (db: Db, now: number) => {
  const targets = await repointMergedArticles(db)
  if (targets.length === 0) return 0
  const rows = await eventRows(db, targets)
  await refreshEvents(db, new Map(rows.map((e) => [e.id, e.centroid])), now)
  return targets.length
}

/**
 * Fold together events ingest kept apart. Active events first seen within CONSOLIDATE.recentHours and updated since
 * the last full run, at most maxEventsPerRun newest updated first, look up the articles nearest their centroid; the
 * active events those sit in, first seen within CLUSTER.maxEventSpanHours of the event, are compared by centroid. From askCosine a copy (mergeCosine, or titles at
 * CLUSTER.copyTitleJaccard) merges outright and the rest merge after Haiku says they are one event, highest cosine
 * first. Every decision goes to `pair_decisions` and no pair is decided twice. The younger event folds into the
 * older, and merges chain within a run. A run that left pairs undecided keeps the previous mark, so they come back.
 */
export const consolidateStep = async (env: { GISTS: VectorizeIndex }, db: Db, llm: Llm | null, now: number) => {
  const repointed = await repoint(db, now)
  const firstSeen = now - CONSOLIDATE.recentHours * HOUR_MS
  const last = await lastRun(db, STEP)
  const recent = await recentEvents(db, {
    firstSeen,
    updatedSince: last?.lastRunAt ?? firstSeen,
    limit: CONSOLIDATE.maxEventsPerRun,
  })
  const found = await inGroups(recent, PARALLEL, async (e) => {
    const res = await env.GISTS.query(e.centroid, { topK: CONSOLIDATE.topK, returnMetadata: "none" })
    return { e, ids: res.matches.map((m) => Number(m.id)) }
  })
  const owners = new Map(
    (
      await articleEvents(
        db,
        found.flatMap((f) => f.ids),
      )
    ).map((r) => [r.articleId, r.eventId]),
  )
  const events = new Map<number, EventRow>(recent.map((e) => [e.id, e]))
  const others = [...new Set(owners.values())].filter((id) => !events.has(id))
  for (const e of await eventRows(db, others)) if (e.status === "active") events.set(e.id, e)

  const pairs = new Map<string, Pair>()
  for (const { e, ids } of found) {
    for (const id of ids) {
      const o = events.get(owners.get(id) ?? Number.NaN)
      if (!o || o.id === e.id || pairs.has(pairKey(e.id, o.id))) continue
      if (Math.abs(o.firstSeen - e.firstSeen) > CLUSTER.maxEventSpanHours * HOUR_MS) continue
      const c = cosine(e.centroid, o.centroid)
      // A shared title needs the cosine too: recurring headlines name distinct events.
      if (c < CONSOLIDATE.askCosine) continue
      const copy = c >= CONSOLIDATE.mergeCosine || titleJaccard(e.title, o.title) >= CLUSTER.copyTitleJaccard
      pairs.set(pairKey(e.id, o.id), { a: e.id, b: o.id, cosine: c, copy })
    }
  }
  const decided = new Map(
    (await pairDecisionsAmong(db, [...events.keys()])).map((d) => [pairKey(d.aEventId, d.bEventId), d.same]),
  )

  const briefs = new Map<number, EventBrief>()
  const brief = async (e: EventRow): Promise<EventBrief> => {
    const cached = briefs.get(e.id)
    if (cached) return cached
    const titles = (await eventMembers(db, [e.id])).slice(0, CLUSTER.briefTitles).map((m) => m.titleEn)
    const out = { id: e.id, title: e.title, gist: e.gist, articleTitles: titles, firstSeen: e.firstSeen }
    briefs.set(e.id, out)
    return out
  }

  const mergedInto = new Map<number, number>()
  const root = (id: number) => {
    let at = id
    for (let next = mergedInto.get(at); next !== undefined; next = mergedInto.get(at)) at = next
    return at
  }
  let asking = llm !== null
  let cached = 0
  let asks = 0
  let merged = 0
  let left = 0
  for (const pair of [...pairs.values()].sort((x, y) => y.cosine - x.cosine)) {
    if (merged >= CONSOLIDATE.maxMergesPerRun) {
      left++
      continue
    }
    const ea = events.get(root(pair.a))
    const eb = events.get(root(pair.b))
    if (!ea || !eb || ea.id === eb.id) continue
    const older = ea.firstSeen < eb.firstSeen || (ea.firstSeen === eb.firstSeen && ea.id < eb.id)
    const [into, from] = older ? [ea, eb] : [eb, ea]
    const decision = { aEventId: from.id, bEventId: into.id, cosine: pair.cosine }
    let same = decided.get(pairKey(from.id, into.id))
    if (same !== undefined) cached++
    else if (pair.copy) {
      same = true
      await savePairDecision(db, { ...decision, same, by: "copy" })
    } else {
      if (!llm || !asking || asks >= CONSOLIDATE.maxAsksPerRun) {
        left++
        continue
      }
      asks++
      try {
        same = await sameEvent(llm, await brief(from), await brief(into))
      } catch (e) {
        if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
        log("consolidate_asks_stopped", { from: from.id, into: into.id, error: String(e) })
        asking = false
        left++
        continue
      }
      await savePairDecision(db, { ...decision, same, by: MODELS.haiku })
      log("consolidate_asked", { from: from.id, into: into.id, cosine: pair.cosine, same })
    }
    decided.set(pairKey(from.id, into.id), same)
    if (!same) continue
    await mergeEvents(db, from.id, into.id, now)
    into.centroid = weightedMean([
      { v: into.centroid, n: into.articleCount },
      { v: from.centroid, n: from.articleCount },
    ])
    into.articleCount += from.articleCount
    await refreshEvents(db, new Map([[into.id, into.centroid]]), now)
    mergedInto.set(from.id, into.id)
    briefs.delete(into.id)
    merged++
    log("merged_events", { from: from.id, into: into.id, cosine: pair.cosine, copy: pair.copy })
  }
  const counts = { events: recent.length, pairs: pairs.size, cached, asked: asks, merged, left, repointed }
  if (left === 0) await markRun(db, STEP, now, counts)
  return llm ? counts : { ...counts, skipped: 1 }
}
