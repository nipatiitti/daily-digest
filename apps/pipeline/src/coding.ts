import { CODING, DAY_MS, HOUR_MS, reports, SUBSTANTIAL } from "@digest/core"
import { byEvent, codingTargets, type Db, eventEntityLinks, eventMembers, saveCodes } from "@digest/db"
import { codeEvents, type Llm, LlmRefusal, SpendCapError } from "@digest/llm"
import { overSoftCap } from "./llm.ts"
import { log } from "./util.ts"

/**
 * Codes due events with Haiku, CODING.perCall per call: hourly the substantial events with an article in the last
 * CODING.backfillDays, latest first, at most CODING.maxPerRun, under the spend soft cap; the edition passes its
 * candidates instead. Each event is coded from its newest reports, origins first. A refused call skips its events,
 * the spend cap stops the run.
 */
export const codingStep = async (
  db: Db,
  llm: Llm | null,
  now: number,
  o: { eventIds?: number[] } = {},
): Promise<Record<string, number>> => {
  if (!llm) {
    log("coding_skipped", { reason: "no ANTHROPIC_API_KEY" })
    return { skipped: 1 }
  }
  const over = o.eventIds ? null : await overSoftCap(llm)
  if (over) {
    log("coding_skipped", over)
    return { skipped: 1 }
  }
  const base = {
    minOrigins: SUBSTANTIAL.minOrigins,
    minOfficial: SUBSTANTIAL.minOfficial,
    factor: CODING.recodeOriginsFactor,
    recodeBefore: now - CODING.recodeAfterHours * HOUR_MS,
  }
  const due = await codingTargets(
    db,
    o.eventIds
      ? { ...base, eventIds: o.eventIds }
      : { ...base, since: now - CODING.backfillDays * DAY_MS, limit: CODING.maxPerRun },
  )
  if (due.length === 0) return { due: 0 }

  const ids = due.map((e) => e.id)
  const [members, entities] = await Promise.all([eventMembers(db, ids), eventEntityLinks(db, ids)])
  const own = byEvent(members)
  const out = { due: due.length, coded: 0, refused: 0, capped: 0 }
  for (let i = 0; i < due.length; i += CODING.perCall) {
    const batch = due.slice(i, i + CODING.perCall)
    try {
      const { codes, callId } = await codeEvents(
        llm,
        batch.map((e) => {
          const ms = own.get(e.id) ?? []
          return {
            id: e.id,
            titles: reports(ms, (m) => m.titleEn, CODING.titlesPerEvent),
            gists: reports(ms, (m) => m.gist, CODING.titlesPerEvent),
            type: e.eventType,
            outlets: e.independentOrigins,
            entities: (entities.get(e.id) ?? []).slice(0, CODING.entitiesPerEvent),
            countries: e.countries,
          }
        }),
      )
      const origins = new Map(batch.map((e) => [e.id, e.independentOrigins]))
      await saveCodes(
        db,
        codes.map((c) => ({ ...c, originsAtCode: origins.get(c.eventId) ?? 0, codedAt: now, llmCallId: callId })),
      )
      out.coded += codes.length
    } catch (e) {
      if (e instanceof SpendCapError) return { ...out, capped: 1 }
      if (!(e instanceof LlmRefusal)) throw e
      out.refused += batch.length
    }
  }
  return out
}
