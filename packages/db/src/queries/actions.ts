import { eq } from "drizzle-orm"
import { type Db, runBatch } from "../client.ts"
import { actions, sources } from "../schema/index.ts"
import { getSource } from "./sources.ts"

/** The audit row for a dashboard write, returned unrun so the caller batches it with the write. */
export const recordAction = (db: Db, action: typeof actions.$inferInsert) => db.insert(actions).values(action)

/** One audited change to a source's poll state; the audit row names `action` and keeps the old and new values. */
const writeSource = async (
  db: Db,
  id: number,
  by: string,
  action: string,
  set: Pick<Partial<typeof sources.$inferInsert>, "enabled" | "nextPollAt" | "consecutiveFailures">,
) => {
  const source = await getSource(db, id)
  if (!source) throw new Error(`Source ${id} does not exist`)
  const old = Object.fromEntries(Object.keys(set).map((k) => [k, source[k as keyof typeof set]]))
  await runBatch(db, [
    db.update(sources).set(set).where(eq(sources.id, id)),
    recordAction(db, {
      kind: action === "poll_now" ? "source_poll" : action === "reset_backoff" ? "source_reset" : "source_toggle",
      subjectKind: "source",
      subjectId: String(id),
      detailJson: { action, old, new: set },
      by,
    }),
  ])
}

/** The dashboard owns `enabled`; the seed sets it only on first insert. */
export const setSourceEnabled = (db: Db, id: number, enabled: boolean, by: string) =>
  writeSource(db, id, by, enabled ? "enable" : "disable", { enabled })

/** Due at once, so the next minute cron polls it. */
export const pollSourceNow = (db: Db, id: number, by: string) => writeSource(db, id, by, "poll_now", { nextPollAt: 0 })

/** Forgets the failures behind its backoff and makes it due at once. */
export const resetSourceBackoff = (db: Db, id: number, by: string) =>
  writeSource(db, id, by, "reset_backoff", { consecutiveFailures: 0, nextPollAt: 0 })
