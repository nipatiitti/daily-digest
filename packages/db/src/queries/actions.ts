import { and, eq, gt, gte, inArray, min, or, type SQL, sql } from "drizzle-orm"
import { type Db, runBatch } from "../client.ts"
import {
  actions,
  articles,
  coerce,
  columnOf,
  entities,
  type FactStatus,
  facts,
  follows,
  rollups,
  rowWhere,
  sources,
  stories,
  storyEntities,
  storyThemes,
  type TableMeta,
  themes,
} from "../schema/index.ts"
import { rowById } from "./dashboard.ts"
import { entityById, refreshEntityCounts, refreshEntityRollups } from "./entities.ts"
import { getStory, mergeStories, setFactStatus } from "./stories.ts"
import { mergeTheme, recordThemeEvent, refreshThemeCounts, refreshThemeRollups, themeById } from "./themes.ts"

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

/**
 * The audit row for an article leaving story `from`, then the close of `from` when that left it active and empty.
 * Both go in the batch after the move: `closedFrom` is evaluated in SQL just before the close, so it says what the
 * close did.
 */
const leaveStory = (db: Db, action: typeof actions.$inferInsert, from: number | null) => {
  if (from === null) return [recordAction(db, action)]
  const emptied = sql`exists (select 1 from stories where id = ${from} and status = 'active')
    and not exists (select 1 from articles where story_id = ${from})`
  const detail = JSON.stringify(action.detailJson ?? {})
  return [
    db.insert(actions).values({
      ...action,
      detailJson: sql`json_set(${detail}, '$.closedFrom', json(iif(${emptied}, 'true', 'false')))`,
    }),
    db
      .update(stories)
      .set({ status: "closed" })
      .where(and(eq(stories.id, from), emptied)),
  ]
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

/**
 * mergeStories runs its own statements, so the audit row goes first and keeps what the merge cannot be undone
 * without: the articles that moved, the source's status and the target's extraction hash.
 */
export const mergeStory = async (
  db: Db,
  fromId: number,
  intoId: number,
  by: string,
  now: number,
  opts?: { velocityWindowMinutes: number },
) => {
  if (fromId === intoId) throw new Error("A story cannot be merged into itself")
  const [from, into, moved] = await Promise.all([
    liveStory(db, fromId),
    liveStory(db, intoId),
    db.select({ id: articles.id }).from(articles).where(eq(articles.storyId, fromId)),
  ])
  await recordAction(db, {
    kind: "merge",
    subjectKind: "story",
    subjectId: String(fromId),
    detailJson: {
      into: intoId,
      articleIds: moved.map((a) => a.id),
      fromStatus: from.status,
      intoHash: into.extractionHash,
    },
    by,
  })
  await mergeStories(db, fromId, intoId, now, opts)
}

export const followStory = async (db: Db, id: number, by: string, expiresAt: number) => {
  const [, [previous]] = await Promise.all([
    liveStory(db, id),
    db.select().from(follows).where(eq(follows.storyId, id)),
  ])
  await runBatch(db, [
    db
      .insert(follows)
      .values({ storyId: id, expiresAt })
      .onConflictDoUpdate({ target: follows.storyId, set: { expiresAt, active: true } }),
    recordAction(db, {
      kind: "follow",
      subjectKind: "story",
      subjectId: String(id),
      detailJson: { expiresAt, previous: previous ?? null },
      by,
    }),
  ])
}

/** Named apart from stories.ts's `setFactStatus`, the bare statement it reuses. */
export const changeFactStatus = async (db: Db, factId: number, storyId: number, status: FactStatus, by: string) => {
  const [[fact]] = await Promise.all([
    db
      .select({ status: facts.status })
      .from(facts)
      .where(and(eq(facts.id, factId), eq(facts.storyId, storyId))),
    liveStory(db, storyId),
  ])
  if (!fact) throw new Error(`Story ${storyId} has no fact ${factId}`)
  await runBatch(db, [
    setFactStatus(db, factId, status),
    recordAction(db, {
      kind: "fact_status",
      subjectKind: "fact",
      subjectId: String(factId),
      detailJson: { storyId, from: fact.status, to: status },
      by,
    }),
  ])
}

/** Closes the story the article left if it is now empty. Returns that story, so the caller can refresh counters. */
export const moveArticle = async (db: Db, articleId: number, intoStoryId: number, by: string) => {
  const [article] = await Promise.all([articleRow(db, articleId), liveStory(db, intoStoryId)])
  if (article.storyId === intoStoryId) throw new Error(`Article ${articleId} is already in story ${intoStoryId}`)
  await runBatch(db, [
    db.update(articles).set({ storyId: intoStoryId }).where(eq(articles.id, articleId)),
    ...leaveStory(
      db,
      {
        kind: "move_article",
        subjectKind: "article",
        subjectId: String(articleId),
        detailJson: { from: article.storyId, into: intoStoryId },
        by,
      },
      article.storyId,
    ),
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
    ...leaveStory(
      db,
      {
        kind: "new_story",
        subjectKind: "story",
        subjectId: String(created.id),
        detailJson: { articleId, from: a.storyId },
        by,
      },
      a.storyId,
    ),
  ])
  return { storyId: created.id, from: a.storyId }
}

/** One cell of a column the registry marks editable, coerced by its kind; the audit row keeps the old and new value. */
export const editCell = async (db: Db, meta: TableMeta, id: string, column: string, value: string, by: string) => {
  if (!meta.editable.includes(column)) throw new Error(`${meta.name}.${column} is not editable`)
  const next = coerce(columnOf(meta, column), value)
  // An editable number is a count or an interval and an editable text a name, so neither may be zero or blank.
  if (typeof next === "number" ? next <= 0 : typeof next === "string" && !next.trim()) {
    throw new Error(`${meta.name}.${column} cannot be "${value}"`)
  }
  const row = await rowById(db, meta, id)
  if (!row) throw new Error(`No ${meta.name} row ${id}`)
  // A value outside the edit list, such as a merged story's status, is neither set nor changed here.
  const allowed = meta.editableValues?.[column]
  if (allowed && ![row[column], next].every((v) => allowed.includes(String(v)))) {
    throw new Error(`${meta.name}.${column} can only change between ${allowed.join(" and ")}`)
  }
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

const HOUR = 3_600_000
const hour = (ms: number) => Math.floor(ms / HOUR) * HOUR

/** An entity that can still be acted on; a missing or merged one is an Error naming it. */
const liveEntity = async (db: Db, id: number) => {
  const entity = await entityById(db, id)
  if (!entity) throw new Error(`Entity ${id} does not exist`)
  if (entity.mergedInto !== null) throw new Error(`${entity.name} was already merged into entity ${entity.mergedInto}`)
  return entity
}

/**
 * Folds alias `fromId` into `intoId` in one batch with the audit row: the alias's story links are copied to the target
 * and kept, the target's seen range widens to cover it, and the alias and its own aliases point at the target, since
 * the fold follows `mergedInto` one level. Then the target's story count, and its rollups over the alias's hours, are
 * recounted. No row is deleted.
 */
export const mergeEntity = async (db: Db, fromId: number, intoId: number, by: string, now = Date.now()) => {
  if (fromId === intoId) throw new Error("An entity cannot be merged into itself")
  const [from, into] = await Promise.all([liveEntity(db, fromId), liveEntity(db, intoId)])
  await runBatch(db, [
    db
      .insert(storyEntities)
      .select(
        db
          .select({
            storyId: storyEntities.storyId,
            entityId: sql<number>`${intoId}`.as("entity_id"),
            firstSeen: storyEntities.firstSeen,
          })
          .from(storyEntities)
          .where(eq(storyEntities.entityId, fromId)),
      )
      .onConflictDoNothing(),
    db
      .update(entities)
      .set({
        firstSeen: sql`min(${entities.firstSeen}, ${from.firstSeen})`,
        lastSeen: sql`max(${entities.lastSeen}, ${from.lastSeen})`,
      })
      .where(eq(entities.id, intoId)),
    db
      .update(entities)
      .set({ mergedInto: intoId })
      .where(or(eq(entities.id, fromId), eq(entities.mergedInto, fromId))),
    recordAction(db, {
      kind: "entity_merge",
      subjectKind: "entity",
      subjectId: String(fromId),
      detailJson: { into: intoId, fromKey: from.key, intoKey: into.key },
      by,
    }),
  ])
  await refreshEntityCounts(db, [intoId])
  await refreshEntityRollups(db, [intoId], hour(from.firstSeen), hour(from.lastSeen) + HOUR, now)
}

/** The display name only; the key stays, so the fold keeps finding the entity. The audit row keeps the old name. */
export const renameEntity = async (db: Db, id: number, name: string, by: string) => {
  const entity = await liveEntity(db, id)
  if (entity.name === name) return
  await runBatch(db, [
    db.update(entities).set({ name }).where(eq(entities.id, id)),
    recordAction(db, {
      kind: "entity_rename",
      subjectKind: "entity",
      subjectId: String(id),
      detailJson: { from: entity.name, to: name },
      by,
    }),
  ])
}

/** A theme that can still be acted on; a missing or merged one is an Error naming it. */
const liveTheme = async (db: Db, id: number) => {
  const theme = await themeById(db, id)
  if (!theme) throw new Error(`Signal ${id} does not exist`)
  if (theme.status === "merged") throw new Error(`${theme.name} was already merged into signal ${theme.mergedInto}`)
  return theme
}

/** The audit row and a theme event, both keeping the old name. */
export const renameTheme = async (db: Db, id: number, name: string, by: string) => {
  const theme = await liveTheme(db, id)
  if (theme.name === name) return
  const detail = { from: theme.name, to: name }
  await runBatch(db, [
    db.update(themes).set({ name }).where(eq(themes.id, id)),
    recordThemeEvent(db, { themeId: id, kind: "renamed", detailJson: { ...detail, by } }),
    recordAction(db, { kind: "theme_rename", subjectKind: "theme", subjectId: String(id), detailJson: detail, by }),
  ])
}

/**
 * Active themes only: a story joining reopens a closed theme as active, which would skip a provisional theme's
 * promotion.
 */
export const closeTheme = async (db: Db, id: number, by: string) => {
  const theme = await liveTheme(db, id)
  if (theme.status !== "active") throw new Error("Only active signals can be closed")
  const detail = { from: theme.status }
  await runBatch(db, [
    db.update(themes).set({ status: "closed" }).where(eq(themes.id, id)),
    recordThemeEvent(db, { themeId: id, kind: "closed", detailJson: { ...detail, by } }),
    recordAction(db, { kind: "theme_close", subjectKind: "theme", subjectId: String(id), detailJson: detail, by }),
  ])
}

/**
 * Rollups are derived counts, so a theme's rows from hour `from` on may be deleted to recount them: the recount only
 * upserts buckets that still have articles, and a bucket that lost them would keep its old count. Returned unrun.
 */
const clearThemeRollups = (db: Db, themeId: number, from: number) =>
  db.delete(rollups).where(and(eq(rollups.kind, "theme"), eq(rollups.key, String(themeId)), gte(rollups.bucket, from)))

/** The hour of the earliest article matching `where`, or null when none does. */
const firstArticleHour = async (db: Db, where: SQL) => {
  const [row] = await db
    .select({ at: min(articles.publishedAt) })
    .from(articles)
    .where(where)
  return row?.at == null ? null : hour(row.at)
}

/**
 * mergeTheme runs its own batch and writes both themes' events, so the audit row goes first, as mergeStory's does,
 * keeping the source's status. Then the target's rollups are cleared and recounted from the first article of the
 * source's linked stories, or from its first seen when they have none, since a theme's stories can predate it.
 */
export const mergeThemeInto = async (db: Db, fromId: number, intoId: number, by: string, now = Date.now()) => {
  if (fromId === intoId) throw new Error("A signal cannot merge into itself")
  const [from, into, first] = await Promise.all([
    liveTheme(db, fromId),
    liveTheme(db, intoId),
    firstArticleHour(
      db,
      inArray(
        articles.storyId,
        db
          .select({ id: storyThemes.storyId })
          .from(storyThemes)
          .where(and(eq(storyThemes.themeId, fromId), gt(storyThemes.confidence, 0))),
      ),
    ),
  ])
  await recordAction(db, {
    kind: "theme_merge",
    subjectKind: "theme",
    subjectId: String(fromId),
    detailJson: { into: intoId, fromName: from.name, intoName: into.name, fromStatus: from.status },
    by,
  })
  await mergeTheme(db, fromId, intoId, by)
  const start = first ?? hour(from.firstSeen)
  await clearThemeRollups(db, intoId, start)
  await refreshThemeRollups(db, [intoId], start, hour(now) + HOUR, now)
}

/**
 * The link is not deleted: it stays with confidence 0, which every reader of links skips, and its old confidence and
 * author go in the event and the audit row. Then the theme's story count is recounted, and its rollups from the
 * story's first article, so the story's articles leave its spine and momentum.
 */
export const detachStoryTheme = async (db: Db, themeId: number, storyId: number, by: string, now = Date.now()) => {
  const link = and(eq(storyThemes.themeId, themeId), eq(storyThemes.storyId, storyId))
  const [theme, [row], first] = await Promise.all([
    liveTheme(db, themeId),
    db.select().from(storyThemes).where(link),
    firstArticleHour(db, eq(articles.storyId, storyId)),
  ])
  if (!row || row.confidence === 0) throw new Error(`Story ${storyId} is not in ${theme.name}`)
  const detail = { storyId, confidence: row.confidence, linkedBy: row.by }
  const subjectId = String(themeId)
  await runBatch(db, [
    db.update(storyThemes).set({ confidence: 0 }).where(link),
    recordThemeEvent(db, { themeId, kind: "detached", detailJson: { ...detail, by } }),
    recordAction(db, { kind: "theme_detach", subjectKind: "theme", subjectId, detailJson: detail, by }),
    ...(first === null ? [] : [clearThemeRollups(db, themeId, first)]),
  ])
  await refreshThemeCounts(db, [themeId])
  if (first !== null) await refreshThemeRollups(db, [themeId], first, hour(now) + HOUR, now)
}
