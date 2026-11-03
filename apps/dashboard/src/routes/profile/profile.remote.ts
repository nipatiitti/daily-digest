import { isCountry, PROFILE, STATUS } from "@digest/core"
import {
  currentProfile,
  decideProposal,
  followedNames,
  pendingProposals,
  profileHistory,
  recordAction,
  saveProfile,
} from "@digest/db"
import { z } from "zod"
import { attempt } from "#lib/forms.ts"
import { db } from "#lib/server/db.ts"
import { form, query } from "$app/server"

/** The current profile with its followed threads and entities named, the pending proposals and the version history. */
export const profilePage = query(async () => {
  const d = db()
  const [current, proposals, history] = await Promise.all([
    currentProfile(d),
    pendingProposals(d),
    profileHistory(d, STATUS.profileHistory),
  ])
  const follows = current ? await followedNames(d, current.profile.follows) : { threads: [], entities: [] }
  return { current, proposals, history, follows }
})

const lines = (s: string) => [...new Set(s.split("\n").map((l) => l.trim()))].filter(Boolean)

/** Saves the edited profile as a new version, keeping the current follows, with its audit row. */
export const saveForm = form(
  z.object({
    text: z.string().trim().max(PROFILE.textMaxChars),
    topics: z
      .array(z.object({ name: z.string().trim().max(PROFILE.topicMaxChars), weight: z.number().int().min(1).max(3) }))
      .max(PROFILE.maxTopics)
      .default([]),
    regions: z.array(z.string().refine(isCountry, "Not a known region")).default([]),
    mutes: z.string().max(PROFILE.mutesMaxChars),
    note: z.string().trim().max(200),
  }),
  async ({ text, topics, regions, mutes, note }) => {
    await attempt(async (by) => {
      const d = db()
      const follows = (await currentProfile(d))?.profile.follows ?? { threads: [], entities: [], countries: [] }
      const profile = { text, topics: topics.filter((t) => t.name), regions, mutes: lines(mutes), follows }
      const version = await saveProfile(d, profile, { by, note: note || "Edited on the dashboard" })
      await recordAction(d, { kind: "profile_edit", subjectKind: "profile", subjectId: String(version), by })
    })
    await profilePage().refresh()
  },
)

/** Accepts or rejects a pending proposal, with its audit row; an accepted one becomes a new version. */
export const decideForm = form(
  z.object({ id: z.number().int().positive(), decision: z.enum(["accept", "reject"]) }),
  async ({ id, decision }) => {
    await attempt(async (by) => {
      const d = db()
      if (!(await pendingProposals(d)).some((p) => p.id === id)) throw new Error(`Proposal ${id} is already decided`)
      const version = await decideProposal(d, id, decision === "accept", by)
      await recordAction(d, {
        kind: `proposal_${decision}` as const,
        subjectKind: "profile",
        subjectId: String(id),
        detailJson: { version },
        by,
      })
    })
    await profilePage().refresh()
  },
)
