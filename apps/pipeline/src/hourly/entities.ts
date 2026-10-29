import { classifyEntity, ENTITIES, HOUR_MS, hourBucket, normaliseEntityKey } from "@digest/core"
import {
  type Db,
  type Entity,
  lastRun,
  linkStoryEntities,
  markRun,
  refreshEntityCounts,
  refreshEntityRollups,
  storiesChangedSince,
  storyEntityInputs,
  upsertEntities,
} from "@digest/db"

const STEP = "entities"

type NewEntity = Pick<Entity, "key" | "name" | "kind" | "firstSeen" | "lastSeen">

/**
 * Fold the entities of stories evaluated since the last run into `entities` and `story_entities`: normalised keys,
 * at most ENTITIES.maxPerStory per story. Links are only added, so a name dropped by a later extraction stays linked.
 * New links get their entities' rollups recounted over the backfill window, since the hourly rollup step only reaches
 * a few hours back and a story is usually evaluated after its first articles.
 */
export const entitiesStep = async (db: Db, now: number) => {
  const floor = now - ENTITIES.backfillDays * 24 * HOUR_MS
  const since = Math.max(floor, (await lastRun(db, STEP))?.detailJson?.cursor ?? floor)
  const changed = await storiesChangedSince(db, since, ENTITIES.maxStoriesPerRun)
  const inputs = await storyEntityInputs(
    db,
    changed.map((c) => c.storyId),
  )

  const byKey = new Map<string, NewEntity>()
  const storyKeys = inputs.map((s) => {
    const keys = new Set<string>()
    for (const name of s.names) {
      if (keys.size >= ENTITIES.maxPerStory) break
      const key = normaliseEntityKey(name, ENTITIES.suffixes)
      if (!key || keys.has(key)) continue
      keys.add(key)
      const e = byKey.get(key)
      if (e) {
        e.firstSeen = Math.min(e.firstSeen, s.firstSeen)
        e.lastSeen = Math.max(e.lastSeen, s.lastSeen)
      } else {
        const kind = classifyEntity(name, { cves: s.cves })
        byKey.set(key, { key, name: name.trim(), kind, firstSeen: s.firstSeen, lastSeen: s.lastSeen })
      }
    }
    return { story: s, keys }
  })

  const ids = await upsertEntities(db, [...byKey.values()])
  const added = await linkStoryEntities(
    db,
    storyKeys.flatMap(({ story, keys }) =>
      [...keys].flatMap((key) => {
        const entityId = ids.get(key)
        return entityId === undefined ? [] : [{ storyId: story.storyId, entityId, firstSeen: story.firstSeen }]
      }),
    ),
  )
  const touched = [...new Set(ids.values())]
  await refreshEntityCounts(db, touched)
  await refreshEntityRollups(
    db,
    [...new Set(added.map((l) => l.entityId))],
    hourBucket(floor),
    hourBucket(now) + HOUR_MS,
    now,
  )

  // A full page resumes from its newest evaluation; otherwise the next run re-reads the last rescanHours.
  const last = changed.at(-1)
  const cursor = last && changed.length === ENTITIES.maxStoriesPerRun ? last.at : now - ENTITIES.rescanHours * HOUR_MS
  const counts = { stories: inputs.length, entities: touched.length, links: added.length }
  await markRun(db, STEP, now, { cursor, ...counts })
  return counts
}
