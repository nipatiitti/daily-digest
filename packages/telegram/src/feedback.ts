export type Vote = "up" | "down"

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] }

const PREFIX = "fb"

export const encodeFeedback = (deliveryId: number, vote: Vote) => `${PREFIX}:${deliveryId}:${vote === "up" ? "u" : "d"}`

export const decodeFeedback = (data: string | undefined): { deliveryId: number; vote: Vote } | null => {
  const m = data?.match(/^fb:(\d+):([ud])$/)
  if (!m?.[1] || !m[2]) return null
  return { deliveryId: Number(m[1]), vote: m[2] === "u" ? "up" : "down" }
}

/** 👍/👎 row attached to every item we send. */
export const feedbackKeyboard = (deliveryId: number): InlineKeyboard => ({
  inline_keyboard: [
    [
      { text: "👍", callback_data: encodeFeedback(deliveryId, "up") },
      { text: "👎", callback_data: encodeFeedback(deliveryId, "down") },
    ],
  ],
})
