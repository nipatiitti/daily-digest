import { CONFIG_VERSION } from "@digest/core"
import { type Db, getDeliveryForFeedback, markUpdateSeen, recordFeedback } from "@digest/db"
import { decodeFeedback, isAllowedChat } from "@digest/telegram"
import { Bot } from "grammy"

export const createBot = (env: Env, db: Db) => {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN)

  // Telegram redelivers on slow or failed responses; handle each update once.
  bot.use(async (ctx, next) => {
    if (await markUpdateSeen(db, ctx.update.update_id)) await next()
  })

  // Answers anyone, so a new chat can find the ID to add to TELEGRAM_CHAT_IDS.
  bot.command("start", (ctx) => ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: "HTML" }))

  bot.on("callback_query:data", async (ctx) => {
    const fb = decodeFeedback(ctx.callbackQuery.data)
    const chatId = ctx.chat?.id
    if (!fb || !isAllowedChat(env.TELEGRAM_CHAT_IDS, chatId)) {
      await ctx.answerCallbackQuery()
      return
    }
    await ctx.answerCallbackQuery({ text: fb.vote === "up" ? "Thanks 👍" : "Noted 👎" })

    const delivery = await getDeliveryForFeedback(db, fb.deliveryId)
    if (!delivery || delivery.chatId !== chatId) return
    await recordFeedback(db, {
      deliveryId: delivery.id,
      storyId: delivery.storyId,
      tgUserId: ctx.from.id,
      vote: fb.vote,
      rubricSnapshot: delivery.storyId
        ? { configVersion: CONFIG_VERSION, rubric: delivery.rubric, weights: {}, score: delivery.score }
        : null,
    })
  })

  bot.catch((err) => console.error(JSON.stringify({ event: "bot_error", error: String(err.error) })))
  return bot
}
