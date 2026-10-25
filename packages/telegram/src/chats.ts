/** Parse the TELEGRAM_CHAT_IDS var ("123, -100456") into numeric chat IDs. */
export const parseChatIds = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map(Number)

export const isAllowedChat = (raw: string | undefined, chatId: number | undefined) =>
  chatId !== undefined && parseChatIds(raw).includes(chatId)
