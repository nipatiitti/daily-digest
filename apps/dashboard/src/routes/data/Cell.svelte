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
  /** Set for an ID the registry knows; the value links to its page. */
  link?: LinkKind
}

let { value, kind, link }: Props = $props()

const PAGES: Partial<Record<LinkKind, string>> = { story: "/stories", article: "/articles", source: "/data/sources" }
const href = $derived(link && PAGES[link] ? `${PAGES[link]}/${value}` : undefined)
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
{:else}
  {String(value)}
{/if}
