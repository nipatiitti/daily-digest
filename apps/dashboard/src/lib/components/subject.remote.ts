import {
  bucketsBetween,
  countryName,
  FORECAST,
  HOME,
  HOUR_MS,
  holtLinear,
  hourBucket,
  isCountry,
  momentum,
  PROFILE,
} from "@digest/core"
import {
  currentProfile,
  entityById,
  entityByKey,
  MOVER_KINDS,
  readDeliveries,
  readEvents,
  readRelated,
  readThread,
  recordAction,
  rollupBuckets,
  setFollow,
  subjectEvents,
} from "@digest/db"
import { error, redirect } from "@sveltejs/kit"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { command, getRequestEvent, query } from "$app/server"
import { countryChip, entityChip, subjectHref, threadChip } from "./LinkChip.svelte"

/** A thread by ID, an entity by key or a country by ISO code, as the profile follows them. */
const Subject = z.object({ kind: z.enum(MOVER_KINDS), key: z.string().min(1).max(200) })
type Subject = z.infer<typeof Subject>

/**
 * The subject's header; null for an unknown one. `id` is the key its rollups and event links use, `followKey` the one
 * the profile follows, and a merged thread or entity names the page key it went into.
 */
const head = async ({ kind, key }: Subject) => {
  if (kind === "country") {
    if (!isCountry(key)) return null
    const name = countryName(key)
    return { id: key, followKey: key, tick: key, label: "Country", name, description: null, firstSeen: 0 }
  }
  if (kind === "thread") {
    const t = /^\d+$/.test(key) ? await readThread(db(), Number(key)) : null
    if (!t) return null
    const id = String(t.id)
    const into = t.mergedInto === null ? null : String(t.mergedInto)
    return { ...t, id, followKey: id, tick: `THR-${id}`, label: t.status, into }
  }
  const e = await entityByKey(db(), key)
  if (!e) return null
  const into = e.mergedInto === null ? null : (await entityById(db(), e.mergedInto))?.key
  const { key: followKey, kind: label, name, firstSeen } = e
  return { id: String(e.id), followKey, tick: followKey, label, name, description: null, firstSeen, into }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Articles per hour, zero-filled, then FORECAST.horizonHours of Holt projection; with the 24 hour and 7 day change. */
const volume = (rows: { bucket: number; articles: number }[], from: number, to: number) => {
  const got = new Map(rows.map((r) => [r.bucket, r.articles]))
  const measured = bucketsBetween(from, to)
  const values = measured.map((b) => got.get(b) ?? 0)
  const change = (hours: number) =>
    momentum({ recent: sum(values.slice(-hours)), previous: sum(values.slice(-2 * hours, -hours)) }).pct
  return {
    labels: [...measured, ...bucketsBetween(to, to + FORECAST.horizonHours * HOUR_MS)].map((b) =>
      new Date(b).toISOString(),
    ),
    values: [...values, ...holtLinear(values.slice(-FORECAST.historyHours))],
    projectFrom: Math.max(0, values.length - 1),
    change24h: change(24),
    change7d: change(24 * 7),
  }
}

/** A thread, entity or country page in one round of reads after its header; merged ones redirect. */
export const subjectPage = query(Subject, async (s) => {
  const h = await head(s)
  if (!h) error(404, `No ${s.kind} ${s.key}`)
  if ("into" in h && h.into) redirect(307, subjectHref(s.kind, h.into))
  const d = db()
  const to = hourBucket(Date.now())
  const from = Math.max(hourBucket(h.firstSeen), to - HOME.chartHours * HOUR_MS)
  const where = subjectEvents(s.kind, h.id)
  const [rows, timeline, related, deliveries, profile] = await Promise.all([
    rollupBuckets(d, s.kind, [h.id], from, to),
    readEvents(d, where, HOME.timelineEvents),
    readRelated(d, where, HOME.related),
    readDeliveries(d, where, HOME.deliveries),
    currentProfile(d),
  ])
  const f = profile?.profile.follows
  const followed = s.kind === "thread" ? f?.threads.map(String) : s.kind === "entity" ? f?.entities : f?.countries
  // The other two kinds, so a subject is never related to itself.
  const groups = [
    { kind: "thread", label: "Threads", chips: related.threads.map(threadChip) },
    { kind: "entity", label: "Entities", chips: related.entities.map(entityChip) },
    { kind: "country", label: "Countries", chips: related.countries.map(countryChip) },
  ]
  return {
    ...h,
    following: followed?.includes(h.followKey) ?? false,
    volume: volume(rows, from, to),
    timeline,
    related: groups.filter((g) => g.kind !== s.kind && g.chips.length),
    deliveries,
  }
})

/** Follows or unfollows the subject: a new profile version and its audit row, then the page refreshes. */
export const follow = command(Subject.extend({ on: z.boolean() }), async ({ on, ...s }) => {
  const h = await head(s)
  if (!h) error(404, `No ${s.kind} ${s.key}`)
  const d = db()
  const by = getRequestEvent().locals.user
  const subjectId = h.followKey
  const version = await setFollow(d, s.kind, subjectId, on, by, PROFILE.maxFollows)
  await recordAction(d, { kind: "follow", subjectKind: s.kind, subjectId, detailJson: { on, version }, by })
  void subjectPage(s).refresh()
})
