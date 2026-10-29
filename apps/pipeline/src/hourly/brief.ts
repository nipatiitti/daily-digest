import { BRIEF, EVAL, HOUR_MS, HOURLY, hourBucket, momentum } from "@digest/core"
import {
  activeStoryTotals,
  type BriefReadout,
  briefMovers,
  type Db,
  deskSlices,
  insertBrief,
  latestBrief,
  risingThemes,
  runBatch,
  themeExamples,
  themesToExplain,
  updateThemeExplanation,
} from "@digest/db"
import { explainTheme, type Llm, SpendCapError, subjectRef, writeBrief } from "@digest/llm"

const ACTIVE = "Active stories"

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

const readout = (label: string, value: number, previous: number | null, against: string): BriefReadout => ({
  label,
  value,
  previous,
  pct: previous === null ? null : momentum({ recent: value, previous }).pct,
  against,
})

/**
 * The hourly brief from the readouts over the momentum window, the largest movers and the previous brief, then a line
 * for each signal whose momentum crossed the band since it was last explained. After momentum; skipped like themes
 * when spend is near the cap.
 */
export const briefStep = async (db: Db, llm: Llm | null, now: number): Promise<Record<string, number>> => {
  if (!llm) {
    log("brief", { skipped: "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const spent = await llm.spentToday()
  const cap = EVAL.spendSoftCap * llm.dailyCapUsd
  if (spent >= cap) {
    log("brief", { skipped: "spend", spent, cap })
    return { skipped: 1 }
  }

  const hours = HOURLY.momentumWindows.short
  const to = hourBucket(now)
  const from = to - hours * HOUR_MS
  const [previous, totals, desk, rising, movers] = await Promise.all([
    latestBrief(db),
    activeStoryTotals(db, from),
    deskSlices(db, from - hours * HOUR_MS, to, 2),
    risingThemes(db, hours, now),
    briefMovers(db, { from, to, minArticles: BRIEF.moverMinArticles, limit: BRIEF.topMovers }),
  ])
  const slice = (i: number) => desk.find((r) => r.slice === i) ?? { articles: 0, newStories: 0 }
  const window = `the ${hours} hours before`
  const lastActive = previous?.moversJson.readouts.find((r) => r.label === ACTIVE)?.value ?? null
  const readouts = [
    readout(ACTIVE, totals.active, lastActive, "the previous brief"),
    readout(`Articles, last ${hours} hours`, slice(1).articles, slice(0).articles, window),
    readout(`New stories, last ${hours} hours`, slice(1).newStories, slice(0).newStories, window),
    readout("Signals rising", rising.recent, rising.previous, window),
  ]

  // A refused or failed brief is logged; the explanations below still run.
  let brief: Awaited<ReturnType<typeof writeBrief>> | null = null
  let briefId: number | null = null
  let briefError: string | null = null
  try {
    brief = await writeBrief(llm, { readouts, movers, previous: previous?.text ?? null, hours })
    briefId = await insertBrief(db, {
      at: now,
      text: brief.text,
      moversJson: { readouts, movers },
      llmCallId: brief.callId,
    })
    await runBatch(
      db,
      brief.themeLines.map((l) => updateThemeExplanation(db, l.themeId, l.line, now)),
    )
  } catch (e) {
    briefError = String(e)
  }

  // After the lines above, so a signal the brief just explained is not due again.
  const due = await themesToExplain(db, { bandPct: BRIEF.explainBandPct, limit: BRIEF.maxExplanations })
  const titles = await themeExamples(
    db,
    due.map((t) => t.id),
    BRIEF.explainStories,
  )
  const explained: number[] = []
  const errors: string[] = []
  const updates: ReturnType<typeof updateThemeExplanation>[] = []
  for (const t of due) {
    try {
      const line = await explainTheme(llm, { ...t, titles: titles.get(t.id) ?? [] })
      updates.push(updateThemeExplanation(db, t.id, line, now))
      explained.push(t.id)
    } catch (e) {
      errors.push(`${t.id}: ${String(e)}`)
      if (e instanceof SpendCapError) break
    }
  }
  // At most BRIEF.maxExplanations UPDATEs of three bound parameters each, so one batch holds them all.
  try {
    await runBatch(db, updates)
  } catch (e) {
    errors.push(`update: ${String(e)}`)
    explained.length = 0
  }

  log("brief", {
    briefId,
    llmCallId: brief?.callId ?? null,
    movers: movers.map(subjectRef),
    droppedIds: brief?.dropped ?? [],
    unknownNumbers: brief?.unknownNumbers ?? 0,
    themeLines: brief?.themeLines.map((l) => l.themeId) ?? [],
    briefError,
    explained,
    errors,
  })
  return {
    movers: movers.length,
    droppedIds: brief?.dropped.length ?? 0,
    unknownNumbers: brief?.unknownNumbers ?? 0,
    themeLines: brief?.themeLines.length ?? 0,
    briefError: briefError === null ? 0 : 1,
    explained: explained.length,
    explainErrors: errors.length,
  }
}
