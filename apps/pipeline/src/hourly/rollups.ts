import { HOUR_MS, HOURLY, hourBucket } from "@digest/core"
import {
  type Db,
  type Rollup,
  type RollupKind,
  rollupStart,
  sourceBucketGroups,
  storyBucketGroups,
  upsertRollups,
} from "@digest/db"

const COUNTS = ["articles", "origins", "newStories", "scoreSum", "scoreN"] as const
type Counts = Partial<Pick<Rollup, (typeof COUNTS)[number]>>

/**
 * Recount the last HOURLY.recomputeBuckets hour buckets for desk, stream, source and story. Desk and stream fold
 * the per-story groups, so a story's score and newness count once per bucket however many articles it had.
 * Entity and theme buckets come from their own steps in later slices.
 */
export const rollupStep = async (db: Db, now: number) => {
  const to = hourBucket(now) + HOUR_MS
  const recent = to - HOURLY.recomputeBuckets * HOUR_MS
  // First run on an empty table: backfill from the oldest article, one day per batch.
  const start = await rollupStart(db)
  let rows = 0
  for (let from = start === null ? recent : hourBucket(start); from < to; from += 24 * HOUR_MS) {
    rows += await rollupWindow(db, now, from, Math.min(from + 24 * HOUR_MS, to))
  }
  return { rows, backfilled: start === null ? 0 : 1 }
}

const rollupWindow = async (db: Db, now: number, from: number, to: number) => {
  const [storyGroups, sourceGroups] = await Promise.all([
    storyBucketGroups(db, from, to),
    sourceBucketGroups(db, from, to),
  ])

  const rows = new Map<string, Rollup>()
  const add = (bucket: number, kind: RollupKind, key: string, counts: Counts) => {
    const id = `${bucket}/${kind}/${key}`
    const row = rows.get(id) ?? {
      bucket,
      kind,
      key,
      articles: 0,
      origins: 0,
      newStories: 0,
      scoreSum: 0,
      scoreN: 0,
      updatedAt: now,
    }
    for (const c of COUNTS) row[c] += counts[c] ?? 0
    rows.set(id, row)
  }

  for (const g of storyGroups) {
    const articles = { articles: g.articles, origins: g.origins }
    const newStories = g.firstSeen !== null && hourBucket(g.firstSeen) === g.bucket ? 1 : 0
    const score = g.score === null ? {} : { scoreSum: g.score, scoreN: 1 }
    add(g.bucket, "desk", "desk", { ...articles, newStories })
    add(g.bucket, "stream", g.category, { ...articles, newStories, ...score })
    if (g.storyId !== null) add(g.bucket, "story", String(g.storyId), { ...articles, ...score })
  }
  for (const g of sourceGroups) {
    add(g.bucket, "source", String(g.sourceId), { articles: g.articles, origins: g.origins })
  }

  await upsertRollups(db, [...rows.values()], { kinds: ["desk", "stream", "source", "story"], from, to })
  return rows.size
}
