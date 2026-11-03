import {
  CLUSTER,
  cosine,
  decideEvent,
  ENTITIES,
  entityBoost,
  eventCounters,
  FACETS,
  HOUR_MS,
  normaliseEntityKey,
  penalisedSimilarity,
  titleJaccard,
  weightedMean,
} from "@digest/core"
import {
  articleEvents,
  type articleFacets,
  articlesToIngest,
  byEvent,
  createEvent,
  type Db,
  type EventHow,
  type EventMember,
  eventMembers,
  eventRows,
  type FacetEntity,
  type IngestArticle,
  linkEventEntities,
  placeArticle,
  runBatch,
  saveFacets,
  savePairDecision,
  sourceNames,
  updateEvent,
  upsertFacetEntities,
} from "@digest/db"
import {
  codeFacets,
  type FacetOutput,
  facetArticles,
  type Llm,
  LlmRefusal,
  MODELS,
  pickEvent,
  SpendCapError,
} from "@digest/llm"
import { embed } from "./embed.ts"
import { log } from "./util.ts"

export { ingestBacklog } from "@digest/db"

export type IngestEnv = { AI: Ai; GISTS: VectorizeIndex }
/** A wake-up only: each run takes the oldest un-ingested articles from D1. */
export type IngestMessage = { articleId: number }

type NewFacets = typeof articleFacets.$inferInsert
type Item = IngestArticle & {
  f: Pick<NewFacets, "titleEn" | "gist" | "entitiesJson" | "countriesJson" | "eventType">
  vector: number[]
}
type Neighbour = {
  id: number
  score: number
  sourceId: number
  eventId: number
  originId: number | null
  titleEn: string
  keys: string[]
}
/** Articles placed earlier in this run, so they match before Vectorize has indexed them. */
type Done = { item: Item; eventId: number; originId: number | null }
type Placement = {
  eventId: number | null
  originId: number | null
  how: EventHow
  candidateEventId: number | null
  cosine: number | null
  /** Candidates Haiku said are another event, with their score, recorded once the new event exists. */
  rejected?: (readonly [number, number])[]
}

const toRow = (f: FacetOutput, model: string): NewFacets => ({
  articleId: f.id,
  titleEn: f.titleEn,
  gist: f.gist,
  entitiesJson: f.entities,
  countriesJson: f.countries,
  eventType: f.eventType,
  advisory: f.advisory,
  opinion: f.opinion,
  roundup: f.roundup,
  promotional: f.promotional,
  model,
})

/** Haiku in chunks; code facets without an LLM, for a refused chunk and for ids it skipped. Stops at the cap. */
const facet = async (llm: Llm | null, missing: IngestArticle[]) => {
  const rows: NewFacets[] = []
  for (let i = 0; i < missing.length; i += FACETS.perCall) {
    const chunk = missing.slice(i, i + FACETS.perCall)
    let out: FacetOutput[] = []
    try {
      if (llm) out = await facetArticles(llm, chunk)
    } catch (e) {
      if (e instanceof SpendCapError) return { rows, capped: 1 }
      if (!(e instanceof LlmRefusal)) throw e
      log("facets_refused", { ids: chunk.map((a) => a.id), error: String(e) })
    }
    const byId = new Map(out.map((f) => [f.id, f]))
    for (const a of chunk) {
      const f = byId.get(a.id)
      rows.push(f ? toRow(f, MODELS.haiku) : toRow(codeFacets(a), "code"))
    }
  }
  return { rows, capped: 0 }
}

/** Every outlet's name as an entity key, so outlets are never linked or ranked as entities. */
export const outletKeys = async (db: Db) =>
  new Set((await sourceNames(db)).map((n) => normaliseEntityKey(n, ENTITIES.suffixes)))

/** Entity keys that may boost a match: not places, not outlets. */
const keysOf = (es: FacetEntity[], outlets: Set<string>) =>
  es.flatMap((e) => {
    const key = e.kind === "place" ? "" : normaliseEntityKey(e.name, ENTITIES.suffixes)
    return key && !outlets.has(key) ? [key] : []
  })

/** Gist neighbours within the window plus same-run articles, each with the event it sits in now. */
const neighbours = async (db: Db, index: VectorizeIndex, item: Item, done: Done[], outlets: Set<string>) => {
  const windowMs = CLUSTER.windowHours * HOUR_MS
  const res = await index.query(item.vector, {
    topK: CLUSTER.topK,
    returnMetadata: "none",
    filter: { published_at: { $gte: item.publishedAt - windowMs, $lte: item.publishedAt + windowMs } },
  })
  const scores = new Map(res.matches.map((m) => [Number(m.id), m.score]))
  scores.delete(item.id)
  const near: Neighbour[] = (await articleEvents(db, [...scores.keys()])).map((r) => ({
    id: r.articleId,
    score: scores.get(r.articleId) ?? 0,
    sourceId: r.sourceId,
    eventId: r.eventId,
    originId: r.originArticleId,
    titleEn: r.titleEn,
    keys: keysOf(r.entities, outlets),
  }))
  for (const d of done) {
    if (Math.abs(d.item.publishedAt - item.publishedAt) > windowMs) continue
    near.push({
      id: d.item.id,
      score: cosine(item.vector, d.item.vector),
      sourceId: d.item.sourceId,
      eventId: d.eventId,
      originId: d.originId,
      titleEn: d.item.f.titleEn,
      keys: keysOf(d.item.f.entitiesJson, outlets),
    })
  }
  return near
}

const place = async (
  db: Db,
  llm: Llm | null,
  item: Item,
  near: Neighbour[],
  outlets: Set<string>,
): Promise<Placement> => {
  // 1. Wire copy of a placed article: same origin, same event. A shared title alone is not enough, since recurring
  // headlines ("CISA Adds Two Known Exploited Vulnerabilities to Catalog") name distinct events.
  const copy = near
    .filter(
      (n) =>
        n.score >= CLUSTER.copyCosine ||
        (n.score >= CLUSTER.askCosine && titleJaccard(n.titleEn, item.f.titleEn) >= CLUSTER.copyTitleJaccard),
    )
    .sort((a, b) => b.score - a.score)[0]
  if (copy) {
    const { eventId, score } = copy
    return { eventId, originId: copy.originId ?? copy.id, how: "copy", candidateEventId: eventId, cosine: score }
  }

  // 2. Best event by its most similar member after the same-source penalty, plus the shared entity boost.
  const mine = new Set(keysOf(item.f.entitiesJson, outlets))
  const scored = new Map<number, { score: number; shared: Set<string> }>()
  for (const n of near) {
    const e = scored.get(n.eventId) ?? { score: Number.NEGATIVE_INFINITY, shared: new Set<string>() }
    e.score = Math.max(e.score, penalisedSimilarity(n.score, n.sourceId === item.sourceId))
    for (const k of n.keys) if (mine.has(k)) e.shared.add(k)
    scored.set(n.eventId, e)
  }
  const ranked = [...scored]
    .map(([id, e]) => [id, e.score + entityBoost(e.shared.size)] as const)
    .sort((a, b) => b[1] - a[1])
  const best = ranked[0]
  const decision = decideEvent(best?.[1] ?? null)
  const candidate = { originId: null, candidateEventId: best?.[0] ?? null, cosine: best?.[1] ?? null }
  if (!best || decision === "new") return { ...candidate, eventId: null, how: "new" }
  if (decision === "join") return { ...candidate, eventId: best[0], how: "join" }
  const fallback = (): Placement =>
    best[1] >= CLUSTER.fallbackCosine
      ? { ...candidate, eventId: best[0], how: "fallback-join" }
      : { ...candidate, eventId: null, how: "fallback-new" }

  // 3. The ask band: one Haiku call over the best few candidate events.
  if (!llm) return fallback()
  const asked = ranked.filter(([, score]) => score >= CLUSTER.askCosine).slice(0, CLUSTER.askCandidates)
  const rows = new Map(
    (
      await eventRows(
        db,
        asked.map(([id]) => id),
      )
    ).map((e) => [e.id, e]),
  )
  const candidates = asked.map(([id]) => {
    const titles = near.filter((n) => n.eventId === id).map((n) => n.titleEn)
    const e = rows.get(id)
    const articleTitles = titles.slice(0, CLUSTER.briefTitles)
    return { id, title: e?.title ?? titles[0] ?? "", gist: e?.gist ?? "", articleTitles, firstSeen: e?.firstSeen }
  })
  try {
    const { titleEn, gist } = item.f
    const pick = await pickEvent(
      llm,
      { titleEn, gist, source: item.source, publishedAt: item.publishedAt },
      candidates,
      best[0],
    )
    const chosen = asked.find(([id]) => id === pick)
    if (!chosen) return { ...candidate, eventId: null, how: "ask-no", rejected: asked }
    return { originId: null, eventId: chosen[0], how: "ask-yes", candidateEventId: chosen[0], cosine: chosen[1] }
  } catch (e) {
    if (e instanceof SpendCapError || e instanceof LlmRefusal) {
      log("cluster_ask_skipped", { articleId: item.id, error: String(e) })
      return fallback()
    }
    throw e
  }
}

/** Link the members' facet entities to their events (outlets skipped) and recount the entities' events. */
const linkEntities = async (db: Db, grouped: Map<number, EventMember[]>) => {
  const outlets = await outletKeys(db)
  const named = new Map<string, Parameters<typeof upsertFacetEntities>[1][number]>()
  const links = new Map<string, { eventId: number; key: string; mentions: number; firstSeen: number }>()
  for (const [eventId, members] of grouped) {
    const firstSeen = members[0]?.publishedAt ?? 0
    const lastSeen = members.at(-1)?.publishedAt ?? 0
    for (const e of members.flatMap((m) => m.entities)) {
      const key = normaliseEntityKey(e.name, ENTITIES.suffixes)
      if (!key || outlets.has(key)) continue
      const n = named.get(key)
      named.set(key, {
        key,
        name: n?.name ?? e.name,
        kind: n?.kind ?? e.kind,
        firstSeen: Math.min(n?.firstSeen ?? firstSeen, firstSeen),
        lastSeen: Math.max(n?.lastSeen ?? lastSeen, lastSeen),
      })
      const link = `${eventId}:${key}`
      links.set(link, { eventId, key, firstSeen, mentions: (links.get(link)?.mentions ?? 0) + 1 })
    }
  }
  const ids = await upsertFacetEntities(db, [...named.values()])
  await linkEventEntities(
    db,
    [...links.values()].flatMap(({ key, ...l }) => {
      const entityId = ids.get(key)
      return entityId === undefined ? [] : [{ ...l, entityId }]
    }),
  )
}

/**
 * Recompute events from their members: counters, title and gist, the given centroid, and entity links. Reopens a
 * closed event; leaves a merged one alone.
 */
export const refreshEvents = async (db: Db, centroids: Map<number, Float32Array>, now: number) => {
  const grouped = byEvent(await eventMembers(db, [...centroids.keys()]))
  await runBatch(
    db,
    [...centroids].flatMap(([id, centroid]) => {
      const c = eventCounters(grouped.get(id) ?? [])
      return c ? [updateEvent(db, id, { ...c, centroid, status: "active", updatedAt: now })] : []
    }),
  )
  await linkEntities(db, grouped)
}

/** Refresh events that gained these vectors: a running mean from the stored centroid and count, no Vectorize read. */
const refreshAdded = async (db: Db, added: Map<number, number[][]>, now: number) => {
  if (added.size === 0) return
  const stored = new Map((await eventRows(db, [...added.keys()])).map((e) => [e.id, e]))
  const centroids = new Map(
    [...added].map(([id, vs]) => {
      const e = stored.get(id)
      const parts = [...(e ? [{ v: e.centroid, n: e.articleCount }] : []), ...vs.map((v) => ({ v, n: 1 }))]
      return [id, weightedMean(parts)] as const
    }),
  )
  await refreshEvents(db, centroids, now)
}

/**
 * v2 ingest, a pull run: the oldest un-ingested articles get facets (reused after a crash), a gist vector in
 * `digest-gists`, and an event, oldest published first. Touched events are then recomputed from their members.
 */
export const ingestArticles = async (
  env: IngestEnv,
  db: Db,
  llm: Llm | null,
  now: number,
): Promise<Record<string, number>> => {
  const pending = await articlesToIngest(db, FACETS.perRun)
  const { rows, capped } = await facet(
    llm,
    pending.filter((a) => !a.facets),
  )
  await saveFacets(db, rows)
  const fresh = new Map(rows.map((r) => [r.articleId, r]))
  // At the cap only articles with facets go on; the rest wait for a later run.
  const ready = pending
    .flatMap((a) => {
      const f = a.facets ?? fresh.get(a.id)
      return f ? [{ ...a, f }] : []
    })
    .sort((a, b) => a.publishedAt - b.publishedAt)
  // A full page that was not capped means more are waiting; the queue consumer chains the next run.
  const more = pending.length === FACETS.perRun && !capped ? 1 : 0
  const counts: Record<string, number> = { faceted: rows.length, embedded: 0, capped, more }
  if (ready.length === 0) return counts

  const vectors = await embed(
    env.AI,
    ready.map((a) => `${a.f.titleEn}\n${a.f.gist}`),
  )
  const items: Item[] = ready.flatMap((a, i) => {
    const vector = vectors[i]
    return vector ? [{ ...a, vector }] : []
  })
  await env.GISTS.upsert(
    items.map((a) => ({ id: String(a.id), values: a.vector, metadata: { published_at: a.publishedAt } })),
  )
  counts.embedded = items.length

  const outlets = await outletKeys(db)
  const done: Done[] = []
  const added = new Map<number, number[][]>()
  try {
    for (const item of items) {
      const near = await neighbours(db, env.GISTS, item, done, outlets)
      const p = await place(db, llm, item, near, outlets)
      const target =
        p.eventId ??
        (await createEvent(db, {
          title: item.f.titleEn,
          gist: item.f.gist,
          centroid: Float32Array.from(item.vector),
          firstSeen: item.publishedAt,
          lastArticleAt: item.publishedAt,
          countriesJson: item.f.countriesJson,
          eventType: item.f.eventType,
          updatedAt: now,
        }))
      // Consolidation never asks again about a pair Haiku already kept apart.
      if (p.rejected?.length) {
        await runBatch(
          db,
          p.rejected.map(([other, cosine]) =>
            savePairDecision(db, { aEventId: target, bEventId: other, same: false, cosine, by: MODELS.haiku }),
          ),
        )
      }
      const { how, originId } = p
      const eventId = await placeArticle(db, {
        articleId: item.id,
        eventId: target,
        originArticleId: originId,
        how,
        cosine: p.cosine,
        candidateEventId: p.candidateEventId,
      })
      done.push({ item, eventId, originId })
      added.set(eventId, [...(added.get(eventId) ?? []), item.vector])
      counts[how] = (counts[how] ?? 0) + 1
      log("placed", { articleId: item.id, eventId, how, nearest: Math.max(0, ...near.map((n) => n.score)) })
    }
  } finally {
    // Placed articles always reach their events' counters, even when a later article failed.
    await refreshAdded(db, added, now)
  }
  return counts
}
