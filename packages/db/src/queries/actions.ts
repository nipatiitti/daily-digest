import { eq } from "drizzle-orm"
import { type Db, runBatch } from "../client.ts"
import {
  actions,
  articles,
  coerce,
  columnOf,
  type FactStatus,
  facts,
  follows,
  rowWhere,
  sources,
  stories,
  type TableMeta,
} from "../schema/index.ts"
import { rowById } from "./dashboard.ts"
import { getStory, mergeStories, setFactStatus } from "./stories.ts"

/** The audit row for a dashboard write, returned unrun so the caller batches it with the write. */
export const recordAction = (db: Db, action: typeof actions.$inferInsert) => db.insert(actions).values(action)

/** A story that can still be acted on; a missing or merged one is an Error naming it. */
const liveStory = async (db: Db, id: number) => {
  const story = await getStory(db, id)
  if (!story) throw new Error(`Story ${id} does not exist`)
  if (story.status === "merged") throw new Error(`Story ${id} was merged into story ${story.mergedInto}`)
  return story
}

const articleRow = async (db: Db, id: number) => {
  const [row] = await db
    .select({
      storyId: articles.storyId,
      title: articles.title,
      publishedAt: articles.publishedAt,
      category: sources.category,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(eq(articles.id, id))
  if (!row) throw new Error(`Article ${id} does not exist`)
  return row
}

export const closeStory = async (db: Db, id: number, by: string) => {
  const story = await liveStory(db, id)
  await runBatch(db, [
    db.update(stories).set({ status: "closed" }).where(eq(stories.id, id)),
    recordAction(db, {
      kind: "close",
      subjectKind: "story",
      subjectId: String(id),
      detailJson: { from: story.status },
      by,
    }),
  ])
}

/** mergeStories runs its own statements, so the audit row follows them instead of sharing their batch. */
export const mergeStory = async (db: Db, fromId: number, intoId: number, by: string, now: number) => {
  if (fromId === intoId) throw new Error("A story cannot be merged into itself")
  await Promise.all([liveStory(db, fromId), liveStory(db, intoId)])
  await mergeStories(db, fromId, intoId, now)
  await recordAction(db, {
    kind: "merge",
    subjectKind: "story",
    subjectId: String(fromId),
    detailJson: { into: intoId },
    by,
  })
}

export const followStory = async (db: Db, id: number, by: string, expiresAt: number) => {
  await liveStory(db, id)
  await runBatch(db, [
    db
      .insert(follows)
      .values({ storyId: id, expiresAt })
      .onConflictDoUpdate({ target: follows.storyId, set: { expiresAt, active: true } }),
    recordAction(db, { kind: "follow", subjectKind: "story", subjectId: String(id), detailJson: { expiresAt }, by }),
  ])
}

/** Named apart from stories.ts's `setFactStatus`, the bare statement it reuses. */
export const changeFactStatus = async (db: Db, factId: number, status: FactStatus, by: string) => {
  const [fact] = await db
    .select({ storyId: facts.storyId, status: facts.status })
    .from(facts)
    .where(eq(facts.id, factId))
  if (!fact) throw new Error(`Fact ${factId} does not exist`)
  await runBatch(db, [
    setFactStatus(db, factId, status),
    recordAction(db, {
      kind: "fact_status",
      subjectKind: "fact",
      subjectId: String(factId),
      detailJson: { storyId: fact.storyId, from: fact.status, to: status },
      by,
    }),
  ])
}

/** Returns the story the article left, so the caller can refresh counters on it and on the target. */
export const moveArticle = async (db: Db, articleId: number, intoStoryId: number, by: string) => {
  const [article] = await Promise.all([articleRow(db, articleId), liveStory(db, intoStoryId)])
  if (article.storyId === intoStoryId) throw new Error(`Article ${articleId} is already in story ${intoStoryId}`)
  await runBatch(db, [
    db.update(articles).set({ storyId: intoStoryId }).where(eq(articles.id, articleId)),
    recordAction(db, {
      kind: "move_article",
      subjectKind: "article",
      subjectId: String(articleId),
      detailJson: { from: article.storyId, into: intoStoryId },
      by,
    }),
  ])
  return article.storyId
}

/** A story seeded from one article, which moves into it. Returns the new story and the one the article left. */
export const newStoryFromArticle = async (db: Db, articleId: number, by: string) => {
  const a = await articleRow(db, articleId)
  const [created] = await db
    .insert(stories)
    .values({ category: a.category, title: a.title, firstSeen: a.publishedAt, lastArticleAt: a.publishedAt })
    .returning({ id: stories.id })
  if (!created) throw new Error("Story insert returned no row")
  await runBatch(db, [
    db.update(articles).set({ storyId: created.id }).where(eq(articles.id, articleId)),
    recordAction(db, {
      kind: "new_story",
      subjectKind: "story",
      subjectId: String(created.id),
      detailJson: { articleId, from: a.storyId },
      by,
    }),
  ])
  return { storyId: created.id, from: a.storyId }
}

/** One cell of a column the registry marks editable, coerced by its kind; the audit row keeps the old and new value. */
export const editCell = async (db: Db, meta: TableMeta, id: string, column: string, value: string, by: string) => {
  if (!meta.editable.includes(column)) throw new Error(`${meta.name}.${column} is not editable`)
  const next = coerce(columnOf(meta, column), value)
  const row = await rowById(db, meta, id)
  if (!row) throw new Error(`No ${meta.name} row ${id}`)
  if (row[column] === next) return
  await runBatch(db, [
    db
      .update(meta.table)
      .set({ [column]: next })
      .where(rowWhere(meta, id)),
    recordAction(db, {
      kind: "edit",
      subjectKind: "cell",
      subjectId: `${meta.name}.${id}.${column}`,
      detailJson: { old: row[column], new: next },
      by,
    }),
  ])
}
