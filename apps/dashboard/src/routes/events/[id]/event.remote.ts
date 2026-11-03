import { HOME } from "@digest/core"
import { eventMembers, readEvent, resolveEventId } from "@digest/db"
import { error, redirect } from "@sveltejs/kit"
import { z } from "zod"
import { countryChip, entityChip, threadChip } from "#lib/components/LinkChip.svelte"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

/** One event with its articles by outlet, outlets in the order of their first report; a merged id redirects. */
export const eventPage = query(z.number().int().positive(), async (id) => {
  const d = db()
  const live = await resolveEventId(d, id)
  if (live === null) error(404, `No event ${id}`)
  if (live !== id) redirect(307, `/events/${live}`)
  const [e, members] = await Promise.all([readEvent(d, id, HOME.deliveries), eventMembers(d, [id])])
  if (!e) error(404, `No event ${id}`)
  const outlets = new Map<string, typeof members>()
  for (const m of members) outlets.set(m.sourceName, [...(outlets.get(m.sourceName) ?? []), m])
  return {
    ...e,
    outlets: [...outlets].map(([name, rows]) => ({
      name,
      role: rows[0]?.sourceRole,
      items: rows.map((m) => ({
        id: m.articleId,
        title: m.titleEn,
        href: m.canonicalUrl,
        at: m.publishedAt,
        outlet: m.domain,
        role: m.originArticleId === null ? undefined : "Copy",
      })),
    })),
    chips: [
      { label: "Threads", chips: e.threads.map(threadChip) },
      { label: "Countries", chips: e.countries.map(countryChip) },
      { label: "Entities", chips: e.entities.map(entityChip) },
    ].filter((g) => g.chips.length),
  }
})
