<script lang="ts" module>
import type { ColumnKind, ColumnMeta, LinkKind } from "@digest/db"

/** The values a select offers for a boolean or enum column; empty for any other. */
export const choices = (c: ColumnMeta) => (c.kind === "boolean" ? ["true", "false"] : (c.values ?? []))
</script>

<script lang="ts">
import { fmtTime } from "#lib/components/index.ts"

type Props = {
  value: unknown
  kind: ColumnKind
  /** The table the value is a row ID of; the value links to its page. */
  link?: LinkKind
}

let { value, kind, link }: Props = $props()

/**
 * Tables with a page of their own; any other links to its row in the data browser. Entities go there too until the
 * entity page at /entities/[key] lands, then to /entities/<key>.
 */
const PAGES: Partial<Record<LinkKind, string>> = { stories: "/stories", articles: "/articles" }
const href = $derived(link && `${PAGES[link] ?? `/data/${link}`}/${encodeURIComponent(String(value))}`)
</script>

{#if value === null || value === undefined}
  <span class="text-ink-subtle">null</span>
{:else if href}
  <a {href} class="dd-tick">{value}</a>
{:else if kind === "timestamp" && typeof value === "number"}
  <!-- now = 0 makes fmtTime always print the day. -->
  <span class="dd-tick whitespace-nowrap" title={new Date(value).toISOString()}>{fmtTime(value, 0)}</span>
{:else if kind === "json"}
  <span class="dd-tick">{JSON.stringify(value)}</span>
{:else if value instanceof Float32Array}
  <span class="text-ink-subtle">{value.length} floats</span>
{:else}
  {String(value)}
{/if}
