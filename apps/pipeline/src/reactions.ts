import { DAY_MS, REACTIONS } from "@digest/core"
import { currentProfile, type Db, insertProposal, lastRun, markRun, reactionVotes } from "@digest/db"
import { type Llm, proposeProfileEdits } from "@digest/llm"

const STEP = "reactions"

/**
 * Nightly: the votes on events cast since the last run, at most REACTIONS.lookbackDays back (every one on the first
 * run), become one pending profile proposal. Too few new votes keep the cursor.
 */
export const reactionsStep = async (db: Db, llm: Llm | null, now: number): Promise<Record<string, number>> => {
  const current = llm ? await currentProfile(db) : null
  if (!llm || !current) return { skipped: 1 }
  const cursor = (await lastRun(db, STEP))?.lastRunAt
  const since = cursor === undefined ? 0 : Math.max(cursor, now - REACTIONS.lookbackDays * DAY_MS)
  const votes = await reactionVotes(db, since, now)
  if (votes.length < REACTIONS.minVotes) return { votes: votes.length, skipped: 1 }
  const proposal = await proposeProfileEdits(llm, current.profile, votes)
  if (proposal) {
    await insertProposal(db, {
      basedOnVersion: current.version,
      editsJson: proposal.edits,
      rationale: proposal.rationale,
      feedbackIdsJson: votes.map((v) => v.feedbackId),
      llmCallId: proposal.callId,
    })
  }
  const counts = { votes: votes.length, proposals: proposal ? 1 : 0, edits: proposal?.edits.length ?? 0 }
  await markRun(db, STEP, now, counts)
  return counts
}
