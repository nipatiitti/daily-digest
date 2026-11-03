<script module lang="ts">
import { countryName } from "@digest/core"
import type { MoverKind } from "@digest/db"

/** The page of a thread (its ID), an entity (its normalised key) or a country (its ISO code). */
export const subjectHref = (kind: MoverKind, key: string) =>
  kind === "thread"
    ? `/threads/${key}`
    : kind === "entity"
      ? `/entities/${encodeURIComponent(key)}`
      : `/countries/${key}`

/** A chip's link, name, and the short code or kind before the name. */
export type Chip = { href: string; name: string; tick: string }

export const threadChip = (t: { id: number; name: string }): Chip => ({
  href: subjectHref("thread", String(t.id)),
  name: t.name,
  tick: `THR-${t.id}`,
})
export const entityChip = (e: { key: string; name: string; kind: string }): Chip => ({
  href: subjectHref("entity", e.key),
  name: e.name,
  tick: e.kind,
})
export const countryChip = (code: string): Chip => ({
  href: subjectHref("country", code),
  name: countryName(code),
  tick: code,
})
</script>

<script lang="ts">
let { href, name, tick }: Chip = $props()
</script>

<a
  {href}
  class="inline-flex min-h-(--size-control-md) max-w-full items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-1 text-ink shadow-xs outline-none transition hover:border-line-control hover:shadow-sm focus-visible:shadow-focus-ring"
>
  <span class="dd-tick">{tick}</span>
  <span class="text-sm/5 font-semibold">{name}</span>
</a>
