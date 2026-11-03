import { storyArticles } from "@digest/db"
import { type ItemStory, renderDigestItem, storyItem } from "@digest/telegram"
import { db } from "./db.ts"

/** A story as the Digest workflow renders it, links picked from its current articles, in Telegram HTML. */
export const renderStory = async (story: ItemStory & { id: number }, isUpdate = false) =>
  renderDigestItem(storyItem(story, await storyArticles(db(), story.id), isUpdate))
