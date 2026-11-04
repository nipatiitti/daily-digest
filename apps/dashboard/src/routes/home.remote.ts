import {
  countryName,
  EDITION_LABEL,
  type Edition,
  editionKey,
  HOME,
  HOUR_MS,
  hourBucket,
  isSubstantial,
} from "@digest/core"
import {
  currentProfile,
  followedLinks,
  MOVER_KINDS,
  readEditionItems,
  readFollowedSince,
  readMovers,
  readShadowItems,
  readSparks,
} from "@digest/db"
import { z } from "zod"
import { subjectHref } from "#lib/components/LinkChip.svelte"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

/**
 * Substantial events first seen since `since` in followed threads, entities and countries, each with the names of
 * what it is followed through. `follows` is false while the profile follows nothing.
 */
export const sinceLastLook = query(z.number().int().nonnegative(), async (since) => {
  const d = db()
  const f = (await currentProfile(d))?.profile.follows
  if (!f) return { follows: false, events: [] }
  const rows = await readFollowedSince(d, f, since, HOME.sinceScan)
  const events = rows.filter(isSubstantial).slice(0, HOME.sinceEvents)
  const links = await followedLinks(d, f, { eventIds: events.map((e) => e.id) })
  return {
    follows: f.threads.length + f.entities.length + f.countries.length > 0,
    events: events.map((e) => ({
      ...e,
      via: [
        ...new Set([
          ...links.filter((l) => l.eventId === e.id).map((l) => l.name),
          ...e.countries.filter((c) => f.countries.includes(c)).map(countryName),
        ]),
      ],
    })),
  }
})

/** The newest hour's top movers, each with its page and articles per hour over the last HOME.sparkHours. */
export const topMovers = query(async () => {
  const d = db()
  const rows = await readMovers(d, HOME.movers)
  const to = hourBucket(Date.now())
  const sparks = await Promise.all(
    MOVER_KINDS.map((k) =>
      readSparks(
        d,
        k,
        rows.filter((r) => r.kind === k).map((r) => r.key),
        to - HOME.sparkHours * HOUR_MS,
        to,
      ),
    ),
  )
  return rows.map((r) => ({
    ...r,
    href: subjectHref(r.kind, r.entityKey ?? r.key),
    spark: sparks[MOVER_KINDS.indexOf(r.kind)]?.get(r.key) ?? [],
  }))
})

/** Today's editions as sent, each with the v2 edition beside it: the live shadow run, else a replay. */
export const todaysEditions = query(async () => {
  const d = db()
  const date = new Date().toISOString().slice(0, 10)
  const editions = (Object.keys(EDITION_LABEL) as Edition[]).map((e) => ({
    key: editionKey(date, e),
    label: EDITION_LABEL[e],
  }))
  const keys = editions.map((e) => e.key)
  const [sent, shadow] = await Promise.all([readEditionItems(d, keys), readShadowItems(d, keys)])
  return editions
    .map(({ key, label }) => {
      const mine = shadow.filter((r) => r.editionKey === key)
      const mode = mine.some((r) => r.mode === "shadow") ? "shadow" : "replay"
      return {
        key,
        label,
        sent: sent.flatMap((r) => (r.editionKey === key ? [{ eventId: r.eventId, title: r.title }] : [])),
        shadow: mine.filter((r) => r.mode === mode),
      }
    })
    .filter((e) => e.sent.length || e.shadow.length)
})
