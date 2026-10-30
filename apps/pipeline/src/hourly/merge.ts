import { ALERT, HOUR_MS, HOURLY, MATCH, penalised, titleJaccard } from "@digest/core"
import { articleStories, type Db, mergeStories, recentStoryArticles, storyArticles } from "@digest/db"
import { type Llm, LlmRefusal, SpendCapError, type StoryBrief, sameStory } from "@digest/llm"

/** Vectorize lookups in flight at once; a Worker keeps at most six connections open. */
const PARALLEL = 6
/** Vectors fetched per getByIds call. */
const ID_BATCH = 20
/** Article headlines shown to Haiku per story. */
const TITLES = 5

type Lead = { id: number; sourceId: number; title: string; publishedAt: number }
type Recent = { id: number; title: string; category: string; firstSeen: number; titles: string[]; lead: Lead | null }
type Pair = { a: number; b: number; cosine: number; copy: boolean }

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

/** World and Finland stories are compared with each other, and security and tech with each other. */
const group = (category: string) => (category === "security" || category === "tech" ? "techsec" : "world")

const inGroups = async <T, R>(items: T[], size: number, run: (item: T) => Promise<R>) => {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  return out
}

/**
 * Fold together stories the matcher kept apart. Every active story first seen within HOURLY.merge.recentHours looks
 * up the articles nearest its lead article; a story in the same topic group whose best article scores at least
 * MATCH.newStoryCosine is a candidate. A wire copy (MATCH.copyCosine or MATCH.copyTitleJaccard) merges outright, the
 * rest after Haiku says they are the same story, highest cosine first and at most HOURLY.merge.maxAsksPerRun asks a
 * run. The younger story folds into the older, so deliveries and facts end up on the story that was first.
 */
export const mergeStep = async (env: Env, db: Db, llm: Llm | null, now: number) => {
  const recent = new Map<number, Recent>()
  for (const r of await recentStoryArticles(db, now - HOURLY.merge.recentHours * HOUR_MS)) {
    let s = recent.get(r.storyId)
    if (!s) {
      s = { id: r.storyId, title: r.storyTitle, category: r.category, firstSeen: r.firstSeen, titles: [], lead: null }
      recent.set(r.storyId, s)
    }
    if (s.titles.length < TITLES) s.titles.push(r.title)
    if (!s.lead && r.originId === null)
      s.lead = { id: r.id, sourceId: r.sourceId, title: r.title, publishedAt: r.publishedAt }
  }
  const leads = [...recent.values()].flatMap((story) => (story.lead ? [{ story, lead: story.lead }] : []))

  const vectors = new Map<number, VectorizeVector["values"]>()
  const idBatches: string[][] = []
  for (let i = 0; i < leads.length; i += ID_BATCH)
    idBatches.push(leads.slice(i, i + ID_BATCH).map((l) => String(l.lead.id)))
  for (const got of await inGroups(idBatches, PARALLEL, (ids) => env.VECTORS.getByIds(ids)))
    for (const v of got) vectors.set(Number(v.id), v.values)

  const found = await inGroups(leads, PARALLEL, async ({ story, lead }) => {
    const values = vectors.get(lead.id)
    if (!values) return { story, lead, matches: [] }
    const windowMs = (MATCH.windowHours[story.category] ?? 72) * HOUR_MS
    const res = await env.VECTORS.query(values, {
      topK: HOURLY.merge.topK,
      returnMetadata: "none",
      filter: { published_at: { $gte: lead.publishedAt - windowMs, $lte: lead.publishedAt + windowMs } },
    })
    const matches = res.matches
      .map((m) => ({ id: Number(m.id), score: m.score }))
      .filter((m) => Number.isInteger(m.id) && m.id !== lead.id)
    return { story, lead, matches }
  })

  const owners = new Map(
    (
      await articleStories(
        db,
        found.flatMap((f) => f.matches.map((m) => m.id)),
      )
    ).map((r) => [r.id, r]),
  )
  const stories = new Map<number, { title: string; firstSeen: number }>(recent)
  const pairs = new Map<string, Pair>()
  for (const { story, lead, matches } of found) {
    for (const m of matches) {
      const o = owners.get(m.id)
      if (!o || o.storyId === story.id || o.status !== "active" || group(o.category) !== group(story.category)) continue
      const cosine = penalised(m.score, o.sourceId === lead.sourceId)
      if (cosine < MATCH.newStoryCosine) continue
      const copy = m.score >= MATCH.copyCosine || titleJaccard(o.title, lead.title) >= MATCH.copyTitleJaccard
      const [a, b] = story.id < o.storyId ? [story.id, o.storyId] : [o.storyId, story.id]
      const key = `${a}:${b}`
      const prev = pairs.get(key)
      pairs.set(key, { a, b, cosine: Math.max(prev?.cosine ?? cosine, cosine), copy: copy || (prev?.copy ?? false) })
      if (!stories.has(o.storyId)) stories.set(o.storyId, { title: o.storyTitle, firstSeen: o.firstSeen })
    }
  }

  const briefs = new Map<number, StoryBrief>()
  const brief = async (id: number): Promise<StoryBrief> => {
    const cached = briefs.get(id)
    if (cached) return cached
    const s = stories.get(id)
    const titles = recent.get(id)?.titles ?? (await storyArticles(db, id)).slice(0, TITLES).map((x) => x.title)
    const out = { title: s?.title ?? titles[0] ?? "", articleTitles: titles, firstSeen: s?.firstSeen }
    briefs.set(id, out)
    return out
  }

  const mergedInto = new Map<number, number>()
  const root = (id: number) => {
    let at = id
    for (let next = mergedInto.get(at); next !== undefined; next = mergedInto.get(at)) at = next
    return at
  }
  const asked = new Set<string>()
  let asking = llm !== null
  let asks = 0
  let merged = 0
  for (const pair of [...pairs.values()].sort((x, y) => y.cosine - x.cosine)) {
    const a = root(pair.a)
    const b = root(pair.b)
    if (a === b) continue
    const sa = stories.get(a)
    const sb = stories.get(b)
    if (!sa || !sb) continue
    const older = sa.firstSeen < sb.firstSeen || (sa.firstSeen === sb.firstSeen && a < b)
    const [into, from] = older ? [a, b] : [b, a]
    if (!pair.copy) {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`
      if (!llm || !asking || asks >= HOURLY.merge.maxAsksPerRun || asked.has(key)) continue
      asked.add(key)
      asks++
      let same: boolean
      try {
        same = await sameStory(llm, await brief(from), await brief(into), from)
      } catch (e) {
        if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
        log("merge_asks_stopped", { from, into, error: String(e) })
        asking = false
        continue
      }
      log("merge_asked", { from, into, cosine: pair.cosine, same })
      if (!same) continue
    }
    await mergeStories(db, from, into, now, { velocityWindowMinutes: ALERT.worldVelocityWindowMinutes })
    mergedInto.set(from, into)
    briefs.delete(into)
    merged++
    log("merged_stories", { from, into, cosine: pair.cosine, how: pair.copy ? "copy" : "ask" })
  }
  return { compared: pairs.size, asked: asks, merged }
}
