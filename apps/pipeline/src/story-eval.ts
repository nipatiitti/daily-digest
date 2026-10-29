import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
  ALERT,
  alertGate,
  EVAL,
  extractCveIds,
  materialUpdate,
  rubricValue,
  sanitizeUserText,
  scoreTier,
  securityMajor,
  storyScore,
} from "@digest/core"
import {
  activeFacts,
  flagStoryArticles,
  getDb,
  getStory,
  insertFacts,
  kevDates,
  lastDelivery,
  linkStoryVulns,
  logGate,
  type Rubric,
  type StoryArticle,
  saveExtraction,
  setFactStatus,
  storyArticles,
  upsertVulns,
} from "@digest/db"
import { extractStory, LlmRefusal, labelFacts, SpendCapError } from "@digest/llm"
import { fetchEpss } from "./enrich.ts"
import { fetchFulltext } from "./fulltext.ts"
import { llmFor } from "./llm.ts"

export type StoryEvalParams = {
  storyId: number
  /** Hash of the story's article set when the run was started; the instance ID carries it too. */
  hash: string
}

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

/** Origins first, authoritative before tier, earliest first within a tier. */
const byImportance = (a: StoryArticle, b: StoryArticle) =>
  Number(a.originId !== null) - Number(b.originId !== null) ||
  Number(b.authoritative) - Number(a.authoritative) ||
  (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) ||
  a.publishedAt - b.publishedAt

const LLM_STEP = { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" } as const

/**
 * Per-story evaluation: full text for the leading articles, Sonnet extraction and rubric, CVE
 * enrichment, score, facts with novelty labels, then the alert and update gates (shadow mode).
 * Counts come from the process stage; the model never writes them.
 */
export class StoryEval extends WorkflowEntrypoint<Env, StoryEvalParams> {
  override async run(event: WorkflowEvent<StoryEvalParams>, step: WorkflowStep) {
    const { storyId, hash } = event.payload
    const db = getDb(this.env.DB)
    const llm = llmFor(this.env, db)
    if (!llm) {
      log("story_eval_skipped", { storyId, hash, reason: "no ANTHROPIC_API_KEY" })
      return { storyId, hash, skipped: "no key" }
    }

    const story = await step.do("load", () => getStory(db, storyId))
    if (story?.status !== "active") return { storyId, hash, skipped: "story gone or closed" }
    const articleList = await step.do("articles", () => storyArticles(db, storyId))
    if (articleList.length === 0) return { storyId, hash, skipped: "no articles" }
    const tierA = articleList.some((a) => a.authoritative)

    // Spend rules (brief section 9): near the cap, only Tier A stories are extracted, up to 1.25x.
    const allowed = await step.do("budget", async () => {
      const spent = await llm.spentToday()
      return tierA || spent < EVAL.spendSoftCap * llm.dailyCapUsd
    })
    if (!allowed) {
      log("story_eval_skipped", { storyId, hash, reason: "spend soft cap, no Tier A source" })
      return { storyId, hash, skipped: "spend" }
    }

    const extraction = await step.do("extract", LLM_STEP, async () => {
      const ranked = [...articleList].sort(byImportance)
      const withText = new Set(ranked.slice(0, EVAL.fulltextArticles).map((a) => a.id))
      const inputs = await Promise.all(
        ranked.map(async (a) => ({
          id: a.id,
          sourceName: a.sourceName,
          tier: a.tier,
          lang: a.lang,
          publishedAt: a.publishedAt,
          title: a.title,
          snippet: a.snippet,
          fulltext: withText.has(a.id) ? await fetchFulltext(this.env.AI, a.canonicalUrl) : null,
        })),
      )
      try {
        return await extractStory(llm, storyId, inputs, { capMultiplier: tierA ? EVAL.tierACapMultiplier : 1 })
      } catch (e) {
        if (e instanceof SpendCapError || e instanceof LlmRefusal) {
          log("story_eval_skipped", { storyId, hash, reason: String(e) })
          return null
        }
        throw e
      }
    })
    if (!extraction) return { storyId, hash, skipped: "extraction" }

    const vulnInfo = await step.do("enrich", async () => {
      const cveIds = [
        ...new Set([
          ...extraction.cves.flatMap((c) => extractCveIds(c)),
          ...articleList.flatMap((a) => extractCveIds(`${a.title}\n${a.snippet ?? ""}`)),
        ]),
      ]
      if (cveIds.length === 0) return { cveIds, maxEpss: null as number | null, kev: false }
      const [epss, kev] = await Promise.all([fetchEpss(cveIds), kevDates(db, cveIds)])
      const now = Date.now()
      await upsertVulns(
        db,
        cveIds.map((cveId) => ({
          cveId,
          epss: epss.get(cveId) ?? null,
          kevDateAdded: kev.get(cveId) ?? null,
          updatedAt: now,
        })),
      )
      await linkStoryVulns(db, storyId, cveIds)
      const scores = cveIds.flatMap((c) => epss.get(c) ?? [])
      return { cveIds, maxEpss: scores.length > 0 ? Math.max(...scores) : null, kev: kev.size > 0 }
    })

    const stored = await step.do("store", LLM_STEP, async () => {
      const now = Date.now()
      const previous = await activeFacts(db, storyId)
      const fresh = extraction.atomic_facts.map((f) => ({ ...f, text: sanitizeUserText(f.text) })).filter((f) => f.text)
      const labels = await labelFacts(
        llm,
        storyId,
        previous.map((f) => ({ id: f.id, text: f.text, type: f.type })),
        fresh.map((f) => ({ text: f.text, type: f.type })),
      ).catch((e: unknown) => {
        // Over the cap or declined: keep every fact as new rather than lose the extraction.
        if (!(e instanceof SpendCapError || e instanceof LlmRefusal)) throw e
        log("novelty_skipped", { storyId, error: String(e) })
        return fresh.map((_, i) => ({ index: i, label: "new" as const, contradicts_fact_id: null }))
      })
      const toInsert = fresh.flatMap((f, i) => {
        const l = labels[i]
        return l && l.label !== "entailed"
          ? [
              {
                storyId,
                text: f.text,
                type: f.type,
                salience: Math.min(3, Math.max(0, f.salience)),
                firstSeen: now,
                supportingArticleIdsJson: f.supporting_article_ids.filter((id) => articleList.some((a) => a.id === id)),
              },
            ]
          : []
      })
      await insertFacts(db, toInsert)
      for (const l of labels) {
        if (l.label === "contradicting" && l.contradicts_fact_id !== null)
          await setFactStatus(db, l.contradicts_fact_id, "contradicted")
      }
      const newKeyFacts = fresh.flatMap((f, i) => {
        const l = labels[i]
        return l && l.label !== "entailed" ? [{ type: f.type, salience: f.salience, label: l.label }] : []
      })

      const rubric = rubricValue(extraction.rubric, extraction.flags)
      const bestTier =
        [...articleList].sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9))[0]?.tier ?? null
      const score = storyScore({
        rubric,
        bestTier,
        lastArticleAt: story.lastArticleAt,
        independentOrigins: story.independentOrigins,
        origins6h: story.origins6h,
        now,
      })
      const tier = scoreTier(score)
      const rubricJson: Rubric = {
        dims: extraction.rubric,
        flags: {
          promotional: extraction.flags.promotional,
          aggregator: extraction.flags.aggregator,
          evergreen: extraction.flags.evergreen,
        },
        value: rubric,
      }
      await saveExtraction(db, storyId, {
        title: sanitizeUserText(extraction.headline) || story.title,
        summary: sanitizeUserText(extraction.what_happened),
        whyMatters: sanitizeUserText(extraction.why_matters),
        primaryEntity: extraction.primary_entity,
        category: extraction.topic,
        fiRelevance: Math.min(2, Math.max(0, extraction.fi_nordic_eu_relevance)),
        rubric: rubricJson,
        score,
        tier,
      })
      await flagStoryArticles(db, storyId, {
        promotional: extraction.flags.promotional,
        aggregator: extraction.flags.aggregator,
        entities: extraction.entities,
        injectionSuspectIds: extraction.injection_suspect_article_ids,
      })
      return { score, tier, newKeyFacts, previousTier: story.tier }
    })

    await step.do("gates", async () => {
      const suspects = new Set(extraction.injection_suspect_article_ids)
      const authoritativeArticles = articleList.filter((a) => a.authoritative)
      const alert = alertGate({
        topic: extraction.topic,
        score: stored.score,
        major: securityMajor({
          breadth: extraction.rubric.breadth,
          kev: vulnInfo.kev,
          exploitedBy: extraction.exploited_claim.claimed ? extraction.exploited_claim.by : null,
          emergencyPatch: extraction.emergency_patch,
          maxEpss: vulnInfo.maxEpss,
        }),
        worldScale: extraction.rubric.severity,
        independentOrigins: story.independentOrigins,
        authoritativeCount: story.authoritativeCount,
        origins30m: story.origins30m,
        injectionOnlyAuthority:
          authoritativeArticles.length > 0 && authoritativeArticles.every((a) => suspects.has(a.id)),
      })
      await logGate(db, {
        storyId,
        gate: "alert",
        decision: alert.pass ? "pass" : "fail",
        reasons: alert.reasons,
        shadow: ALERT.shadow,
      })
      if (alert.pass) log("would_alert", { storyId, score: stored.score, reasons: alert.reasons })

      const delivered = await lastDelivery(db, storyId)
      if (delivered) {
        const reasons = materialUpdate({
          newKeyFacts: stored.newKeyFacts,
          previousTier: delivered.scoreAtSend === null ? null : scoreTier(delivered.scoreAtSend),
          tier: stored.tier,
          previousOrigins: null,
          origins: story.independentOrigins,
        })
        await logGate(db, {
          storyId,
          gate: "update",
          decision: reasons.length > 0 ? "pass" : "fail",
          reasons: reasons.length > 0 ? reasons : ["no material change"],
          shadow: false,
        })
      }
    })

    log("story_eval_done", { storyId, hash, score: stored.score, tier: stored.tier, cves: vulnInfo.cveIds.length })
    return { storyId, hash, score: stored.score, tier: stored.tier }
  }
}
