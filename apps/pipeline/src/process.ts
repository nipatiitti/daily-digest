import {
  articleSetHash,
  cosine,
  decideMatch,
  EMBED,
  EVIDENCE,
  embeddingText,
  extractCveIds,
  MATCH,
  penalised,
  titleJaccard,
} from "@digest/core"
import {
  articlesToProcess,
  assignArticle,
  createStory,
  type Db,
  getStoryExtractionHash,
  logGate,
  logMatch,
  type MatchHow,
  neighbourAssignments,
  type ProcessArticle,
  refreshStoryCounters,
  setStoryExtractionHash,
  storiesBrief,
  storiesWithCves,
} from "@digest/db"
import { type Llm, LlmRefusal, SpendCapError, sameEvent } from "@digest/llm"
import type { StoryEvalParams } from "./story-eval.ts"

export type ProcessMessage = { articleId: number }

const HOUR = 3_600_000

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

type Neighbour = {
  id: number
  score: number
  sourceId: number
  storyId: number | null
  originId: number | null
  title: string
}

/** Articles already handled in this batch, so same-batch stories match before Vectorize has indexed them. */
type Done = { article: ProcessArticle; vector: number[]; storyId: number; originId: number | null }

const embed = async (ai: Ai, texts: string[]): Promise<number[][]> => {
  const out = (await ai.run(EMBED.model, { text: texts, truncate_inputs: true })) as { data?: number[][] }
  if (!out.data || out.data.length !== texts.length)
    throw new Error(`embedding returned ${out.data?.length ?? 0} vectors`)
  return out.data
}

/** Vectorize neighbours plus same-batch neighbours, with their current story and origin. */
const neighbours = async (
  db: Db,
  index: VectorizeIndex,
  article: ProcessArticle,
  vector: number[],
  done: Done[],
): Promise<Neighbour[]> => {
  const windowMs = (MATCH.windowHours[article.category] ?? 72) * HOUR
  const since = article.publishedAt - windowMs
  const until = article.publishedAt + windowMs
  const matches = await index.query(vector, {
    topK: MATCH.topK,
    returnMetadata: "none",
    filter: { published_at: { $gte: since, $lte: until } },
  })
  const fromIndex = matches.matches
    .map((m) => ({ id: Number(m.id), score: m.score }))
    .filter((m) => Number.isInteger(m.id) && m.id !== article.id)
  const rows = await neighbourAssignments(
    db,
    fromIndex.map((m) => m.id),
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const result: Neighbour[] = fromIndex.flatMap((m) => {
    const r = byId.get(m.id)
    return r ? [{ ...r, score: m.score }] : []
  })
  for (const d of done) {
    if (Math.abs(d.article.publishedAt - article.publishedAt) > windowMs) continue
    result.push({
      id: d.article.id,
      score: cosine(vector, d.vector),
      sourceId: d.article.sourceId,
      storyId: d.storyId,
      originId: d.originId,
      title: d.article.title,
    })
  }
  return result
}

type Placement = {
  storyId: number | null
  originId: number | null
  how: MatchHow
  candidateStoryId: number | null
  cosine: number | null
}

const place = async (
  db: Db,
  llm: Llm | null,
  article: ProcessArticle,
  near: Neighbour[],
  cveIds: string[],
): Promise<Placement> => {
  // 1. Wire copy of an existing article: same origin, same story.
  const copy = near
    .filter((n) => n.score >= MATCH.copyCosine || titleJaccard(n.title, article.title) >= MATCH.copyTitleJaccard)
    .sort((a, b) => b.score - a.score)[0]
  if (copy?.storyId !== null && copy?.storyId !== undefined) {
    const { storyId, score } = copy
    return { storyId, originId: copy.originId ?? copy.id, how: "copy", candidateStoryId: storyId, cosine: score }
  }

  // 2. Best story by the most similar member, after the same-source penalty.
  const byStory = new Map<number, number>()
  for (const n of near) {
    if (n.storyId === null) continue
    const s = penalised(n.score, n.sourceId === article.sourceId)
    byStory.set(n.storyId, Math.max(byStory.get(n.storyId) ?? Number.NEGATIVE_INFINITY, s))
  }

  // 3. Hard key: a shared CVE always makes the stories merge candidates.
  const cveStories = await storiesWithCves(db, cveIds, article.publishedAt - 14 * 24 * HOUR)
  for (const id of cveStories) byStory.set(id, Math.max(byStory.get(id) ?? 0, MATCH.joinCosine))

  const ranked = [...byStory.entries()].sort((a, b) => b[1] - a[1])
  const best = ranked[0]
  const decision = decideMatch(best?.[1] ?? null)
  const candidate = { originId: null, candidateStoryId: best?.[0] ?? null, cosine: best?.[1] ?? null }
  if (!best || decision === "new") return { ...candidate, storyId: null, how: "new" }
  if (decision === "join") return { ...candidate, storyId: best[0], how: cveStories.includes(best[0]) ? "cve" : "join" }
  const fallback = (): Placement =>
    best[1] >= MATCH.fallbackCosine
      ? { ...candidate, storyId: best[0], how: "join-fallback" }
      : { ...candidate, storyId: null, how: "new-fallback" }

  // 4. The ask band.
  if (!llm) return fallback()
  const [story] = await storiesBrief(db, [best[0]])
  const titles = near.filter((n) => n.storyId === best[0]).map((n) => n.title)
  try {
    const same = await sameEvent(
      llm,
      { title: article.title, snippet: article.snippet, source: String(article.sourceId) },
      { title: story?.title ?? titles[0] ?? "", articleTitles: titles.slice(0, 5) },
      best[0],
    )
    return same ? { ...candidate, storyId: best[0], how: "ask-yes" } : { ...candidate, storyId: null, how: "ask-no" }
  } catch (e) {
    if (e instanceof SpendCapError || e instanceof LlmRefusal) {
      log("match_ask_skipped", { articleId: article.id, error: String(e) })
      return fallback()
    }
    throw e
  }
}

/** Evidence gate: enough independent reporting to spend Sonnet on the story. */
const clearsEvidenceBar = (c: { independentOrigins: number; authoritativeCount: number; finnishSources: number }) => {
  const reasons: string[] = []
  if (c.independentOrigins >= EVIDENCE.minIndependentOrigins) reasons.push(`origins=${c.independentOrigins}`)
  if (c.authoritativeCount >= EVIDENCE.authoritativeCount) reasons.push(`authoritative=${c.authoritativeCount}`)
  if (c.finnishSources > 0) reasons.push(`finnish=${c.finnishSources}`)
  return reasons
}

export type ProcessEnv = { AI: Ai; VECTORS: VectorizeIndex; STORY_EVAL: Workflow<StoryEvalParams> }

/**
 * Process stage: embed with bge-m3, upsert to Vectorize, collapse wire copies, match each
 * article to a story, refresh counters and start StoryEval when a story crosses the evidence bar.
 */
export const processArticles = async (env: ProcessEnv, db: Db, llm: Llm | null, ids: number[], now = Date.now()) => {
  const rows = (await articlesToProcess(db, ids)).filter((a) => a.storyId === null)
  if (rows.length === 0) return
  // Oldest first, so a batch about one event grows a single story.
  rows.sort((a, b) => a.publishedAt - b.publishedAt)

  const vectors = await embed(
    env.AI,
    rows.map((a) => embeddingText(a.title, a.snippet, EMBED.maxChars)),
  )

  const done: Done[] = []
  const matches: Parameters<typeof logMatch>[1] = []
  const touched = new Set<number>()
  for (const [i, article] of rows.entries()) {
    const vector = vectors[i]
    if (!vector) continue
    const cveIds = extractCveIds(`${article.title}\n${article.snippet ?? ""}`)
    const near = await neighbours(db, env.VECTORS, article, vector, done)
    const p = await place(db, llm, article, near, cveIds)
    const storyId =
      p.storyId ??
      (await createStory(db, { category: article.category, title: article.title, publishedAt: article.publishedAt }))
    await assignArticle(db, article.id, { storyId, originId: p.originId, cveIds, embeddedAt: now })
    done.push({ article, vector, storyId, originId: p.originId })
    touched.add(storyId)
    matches.push({ articleId: article.id, storyId, how: p.how, cosine: p.cosine, candidateStoryId: p.candidateStoryId })
    log("matched", { articleId: article.id, storyId, how: p.how, nearest: Math.max(0, ...near.map((n) => n.score)) })
  }
  await logMatch(db, matches)

  await env.VECTORS.upsert(
    done.map((d) => ({
      id: String(d.article.id),
      values: d.vector,
      metadata: { published_at: d.article.publishedAt, category: d.article.category, source_id: d.article.sourceId },
    })),
  )

  for (const storyId of touched) {
    const counters = await refreshStoryCounters(db, storyId, now)
    if (!counters) continue
    const reasons = clearsEvidenceBar(counters)
    if (reasons.length === 0) {
      await logGate(db, {
        storyId,
        gate: "evidence",
        decision: "fail",
        reasons: [`origins=${counters.independentOrigins}`],
        shadow: false,
      })
      continue
    }
    const hash = articleSetHash(counters.articleIds)
    if ((await getStoryExtractionHash(db, storyId)) === hash) continue
    await logGate(db, { storyId, gate: "evidence", decision: "pass", reasons, shadow: false })
    await setStoryExtractionHash(db, storyId, hash)
    try {
      await env.STORY_EVAL.create({ id: `story-${storyId}-${hash}`, params: { storyId, hash } })
    } catch (e) {
      log("story_eval_create_failed", { storyId, hash, error: String(e) })
    }
  }
}
