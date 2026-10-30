import { env } from "cloudflare:workers"
import { type StorySender, storyArticles } from "@digest/db"
import { feedbackKeyboard, type ItemStory, parseChatIds, renderDigestItem, storyItem } from "@digest/telegram"
import { Api } from "grammy"
import { db } from "./db.ts"

/** A story as the Digest workflow renders it, links picked from its current articles, in Telegram HTML. */
export const renderStory = async (story: ItemStory & { id: number }, isUpdate = false) =>
  renderDigestItem(storyItem(story, await storyArticles(db(), story.id), isUpdate))

/** The bot and the digest's chats, sending as the Digest workflow does; null until TELEGRAM_BOT_TOKEN is set. */
export const telegram = () => {
  if (!env.TELEGRAM_BOT_TOKEN) return null
  const api = new Api(env.TELEGRAM_BOT_TOKEN)
  const bot: StorySender = {
    render: (story) => renderStory(story),
    send: async (chatId, html, deliveryId) => {
      const msg = await api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        reply_markup: feedbackKeyboard(deliveryId),
        link_preview_options: { is_disabled: true },
      })
      return msg.message_id
    },
  }
  return { bot, chatIds: parseChatIds(env.TELEGRAM_CHAT_IDS) }
}
