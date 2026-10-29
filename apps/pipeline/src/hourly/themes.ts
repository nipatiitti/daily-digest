import {
  EMBED,
  ENTITIES,
  EVAL,
  embeddingText,
  HOUR_MS,
  hourBucket,
  nearestThemes,
  pickThemeCandidates,
  THEMES,
} from "@digest/core"
import {
  activeThemesWithEmbeddings,
  assignStoryTheme,
  candidateThemesByEntities,
  closeQuietThemes,
  createTheme,
  type Db,
  getStory,
  lastRun,
  markRun,
  promoteProvisionalThemes,
  refreshThemeRollups,
  type Story,
  storiesChangedSince,
  storyEntityList,
  storyThemeLinks,
  themeExamples,
} from "@digest/db"
import { decideTheme, type Llm, MODELS, nameTheme, SpendCapError, type ThemeStory } from "@digest/llm"
import { embed } from "../process.ts"

const STEP = "themes"

type How = "join" | "new" | "merge" | "skip" | "error"
type LiveTheme = Awaited<ReturnType<typeof activeThemesWithEmbeddings>>[number]

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

/**
 * Sort stories extracted since the last run into themes, then promote provisional themes that earned a place and
 * close quiet ones. The lifecycle costs nothing, so it runs even when spend or a missing key skips the sorting.
 */
export const themesStep = async (env: Env, db: Db, llm: Llm | null, now: number) => {
  const counts = await sortStories(env, db, llm, now)
  const promoted = await drain(() =>
    promoteProvisionalThemes(db, { minStories: THEMES.visibleStories, minScore: THEMES.visibleScore }),
  )
  const closed = await drain(() => closeQuietThemes(db, now - THEMES.closeAfterDays * 24 * HOUR_MS))
  return { ...counts, promoted, closed }
}

/** Calls a paged lifecycle query until it finds nothing; returns the total. */
const drain = async (page: () => Promise<number[]>) => {
  let total = 0
  for (let ids = await page(); ids.length > 0; ids = await page()) total += ids.length
  return total
}

/**
 * Candidates are themes sharing entities with the story plus the live themes nearest its bge-m3 embedding. Haiku
 * joins one or proposes a theme; Sonnet creates the proposal or merges it into a near theme. Stories linked since
 * their latest extraction were sorted by an earlier run's overlap and are passed over. A skipped run keeps its cursor.
 */
const sortStories = async (env: Env, db: Db, llm: Llm | null, now: number) => {
  if (!llm) {
    log("themes_skipped", { reason: "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const spent = await llm.spentToday()
  const cap = EVAL.spendSoftCap * llm.dailyCapUsd
  if (spent >= cap) {
    log("themes_skipped", { spent, cap })
    return { skipped: 1 }
  }

  const floor = now - THEMES.backfillDays * 24 * HOUR_MS
  const since = Math.max(floor, (await lastRun(db, STEP))?.detailJson?.cursor ?? floor)
  const changed = await storiesChangedSince(db, since, THEMES.maxStoriesPerRun)
  const extractedAt = new Map(changed.map((c) => [c.storyId, c.at]))
  const linked = new Map<number, Set<number>>()
  const sorted = new Set<number>()
  for (const l of await storyThemeLinks(db, [...extractedAt.keys()])) {
    linked.set(l.storyId, (linked.get(l.storyId) ?? new Set<number>()).add(l.themeId))
    if (l.assignedAt >= (extractedAt.get(l.storyId) ?? now)) sorted.add(l.storyId)
  }
  const pending = changed.filter((c) => !sorted.has(c.storyId))
  const stories = (await Promise.all(pending.map((c) => getStory(db, c.storyId)))).filter(
    (s): s is Story => s !== null && s.status !== "merged",
  )
  // Headline and summary, or the headline alone before a summary exists.
  const vectors = stories.length
    ? await embed(
        env.AI,
        stories.map((s) => embeddingText(s.title, s.summary, EMBED.maxChars)),
      )
    : []
  const live = new Map((stories.length ? await activeThemesWithEmbeddings(db) : []).map((t) => [t.id, t]))

  const tally: Record<How, number> = { join: 0, new: 0, merge: 0, skip: 0, error: 0 }
  const touched = new Set<number>()
  let capped = false
  for (const [i, story] of stories.entries()) {
    const vector = vectors[i]
    if (!vector) continue
    try {
      const { how, themeId } = await sortStory(db, llm, story, new Float32Array(vector), live, linked, now)
      tally[how]++
      if (how !== "skip") touched.add(themeId)
      log("theme", { how, storyId: story.id, themeId })
    } catch (e) {
      tally.error++
      log("theme", { how: "error", storyId: story.id, themeId: null, error: String(e) })
      if (e instanceof SpendCapError) {
        capped = true
        break
      }
    }
  }
  await refreshThemeRollups(db, [...touched], hourBucket(floor), hourBucket(now) + HOUR_MS, now)

  // A full page resumes from its newest extraction; otherwise the next run re-reads the last rescanHours.
  const last = changed.at(-1)
  const cursor = last && changed.length === THEMES.maxStoriesPerRun ? last.at : now - THEMES.rescanHours * HOUR_MS
  const counts = { stories: changed.length, alreadySorted: sorted.size, ...tally }
  if (!capped) await markRun(db, STEP, now, { cursor, ...counts })
  return counts
}

const sortStory = async (
  db: Db,
  llm: Llm,
  story: Story,
  embedding: Float32Array,
  live: Map<number, LiveTheme>,
  linked: Map<number, Set<number>>,
  now: number,
): Promise<{ how: Exclude<How, "error">; themeId: number }> => {
  const [entities, shared] = await Promise.all([
    storyEntityList(db, story.id, ENTITIES.maxPerStory),
    candidateThemesByEntities(db, story.id, THEMES.sharedEntitiesMin, THEMES.maxCandidates),
  ])
  const nearest = nearestThemes(embedding, [...live.values()], THEMES.nearestK)
  const candidates = pickThemeCandidates({ sharedEntities: shared, nearest, limit: THEMES.maxCandidates })
  const naming = nearest.slice(0, THEMES.namingNearest)
  const examples = await themeExamples(
    db,
    [...new Set([...candidates, ...naming].map((c) => c.id))],
    THEMES.examplesPerCandidate,
  )
  const inputs = (cs: { id: number }[]) =>
    cs.flatMap((c) => {
      const t = live.get(c.id)
      return t ? [{ id: t.id, name: t.name, description: t.description, examples: examples.get(t.id) ?? [] }] : []
    })
  const link = async (how: "join" | "merge", themeId: number, confidence: number, by: string) => {
    if (linked.get(story.id)?.has(themeId)) return { how: "skip" as const, themeId }
    await assignStoryTheme(db, { storyId: story.id, themeId, confidence, by, at: now })
    return { how, themeId }
  }

  const input: ThemeStory = {
    id: story.id,
    headline: story.title,
    summary: story.summary,
    entities: entities.map((e) => e.name),
    stream: story.category,
  }
  const decision = await decideTheme(llm, input, inputs(candidates))
  if (decision.decision === "join") return link("join", decision.themeId, decision.confidence, MODELS.haiku)
  const { proposedName, proposedDescription } = decision
  const named = await nameTheme(llm, { proposedName, proposedDescription, story: input }, inputs(naming))
  if (named.action === "merge") return link("merge", named.intoThemeId, 1, MODELS.sonnet)
  const { name, description } = named
  const themeId = await createTheme(db, {
    name,
    description,
    embedding,
    firstSeen: now,
    storyId: story.id,
    confidence: 1,
    by: MODELS.sonnet,
  })
  // Later stories in this run can join it.
  live.set(themeId, { id: themeId, name, description, status: "provisional", embedding })
  return { how: "new", themeId }
}
