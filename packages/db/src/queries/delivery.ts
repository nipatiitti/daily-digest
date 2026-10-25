import { eq } from "drizzle-orm"
import type { Db } from "../client.ts"
import {
  deliveries,
  digests,
  feedback,
  type RubricSnapshot,
  stories,
  telegramUpdates,
  type Vote,
} from "../schema/index.ts"

/** Claim a day's digest. False means another run already has it. */
export const claimDigest = async (db: Db, digestDate: string) => {
  const rows = await db
    .insert(digests)
    .values({ digestDate })
    .onConflictDoNothing()
    .returning({ digestDate: digests.digestDate })
  return rows.length > 0
}

export const finishDigest = (db: Db, digestDate: string, status: "sent" | "failed", itemCount: number, now: number) =>
  db
    .update(digests)
    .set({ status, itemCount, sentAt: status === "sent" ? now : null })
    .where(eq(digests.digestDate, digestDate))

export const recordDelivery = async (db: Db, row: typeof deliveries.$inferInsert) => {
  const [inserted] = await db.insert(deliveries).values(row).returning({ id: deliveries.id })
  if (!inserted) throw new Error("delivery insert returned no row")
  return inserted.id
}

export const setDeliveryMessageId = (db: Db, id: number, messageId: number) =>
  db.update(deliveries).set({ messageId }).where(eq(deliveries.id, id))

/** A delivery with its story's score and rubric, for the feedback snapshot. */
export const getDeliveryForFeedback = async (db: Db, id: number) => {
  const [row] = await db
    .select({
      id: deliveries.id,
      chatId: deliveries.chatId,
      storyId: deliveries.storyId,
      rubric: stories.rubricJson,
      score: stories.score,
    })
    .from(deliveries)
    .leftJoin(stories, eq(stories.id, deliveries.storyId))
    .where(eq(deliveries.id, id))
  return row
}

/** Store a Telegram update ID. False means it was already handled. */
export const markUpdateSeen = async (db: Db, updateId: number) => {
  const rows = await db
    .insert(telegramUpdates)
    .values({ updateId })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdates.updateId })
  return rows.length > 0
}

/** One vote per user per delivery; a second tap replaces the first. */
export const recordFeedback = (
  db: Db,
  v: {
    deliveryId: number
    storyId: number | null
    tgUserId: number
    vote: Vote
    rubricSnapshot: RubricSnapshot | null
  },
) =>
  db
    .insert(feedback)
    .values({
      deliveryId: v.deliveryId,
      storyId: v.storyId,
      tgUserId: v.tgUserId,
      vote: v.vote,
      rubricSnapshotJson: v.rubricSnapshot,
    })
    .onConflictDoUpdate({
      target: [feedback.deliveryId, feedback.tgUserId],
      set: { vote: v.vote },
    })
