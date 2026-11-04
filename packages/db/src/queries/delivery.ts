import { eq } from "drizzle-orm"
import type { Db } from "../client.ts"
import { deliveries, digests, feedback, telegramUpdates, type Vote } from "../schema/index.ts"

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

/** A delivery's id and chat, so a vote counts only from the chat it was sent to. */
export const getDeliveryForFeedback = async (db: Db, id: number) => {
  const [row] = await db
    .select({ id: deliveries.id, chatId: deliveries.chatId })
    .from(deliveries)
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

/** One vote per user per delivery; a second tap replaces the first and counts as cast now. */
export const recordFeedback = (db: Db, v: { deliveryId: number; tgUserId: number; vote: Vote }) =>
  db
    .insert(feedback)
    .values({ deliveryId: v.deliveryId, tgUserId: v.tgUserId, vote: v.vote })
    .onConflictDoUpdate({
      target: [feedback.deliveryId, feedback.tgUserId],
      set: { vote: v.vote, createdAt: Date.now() },
    })
