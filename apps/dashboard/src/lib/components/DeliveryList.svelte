<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import type { DeliveryKind } from "@digest/db"
import { fmtInt, fmtTime } from "./format.ts"

type Item = {
  eventId: number
  title: string
  kind: DeliveryKind
  editionKey: string | null
  sentAt: number
  up: number
  down: number
}

/** Newest first; `titles` links each item to its event, for lists that span events. */
let { items, titles = false }: { items: Item[]; titles?: boolean } = $props()

const KIND: Record<DeliveryKind, string> = { digest: "Digest", alert: "Alert", update: "Update", follow: "Follow" }
</script>

{#if items.length}
  <ul class="grid divide-y divide-line">
    {#each items as d (`${d.eventId}/${d.kind}/${d.editionKey}`)}
      <li class="dd-body-sm flex flex-wrap items-baseline gap-x-6 gap-y-1 py-2">
        <time class="dd-tick whitespace-nowrap" datetime={new Date(d.sentAt).toISOString()}>{fmtTime(d.sentAt)}</time>
        {#if d.editionKey}
          <a href="/digest/{d.editionKey}" class="font-semibold hover:underline">{KIND[d.kind]}</a>
        {:else}
          <span class="font-semibold">{KIND[d.kind]}</span>
        {/if}
        {#if titles}<a href="/events/{d.eventId}" class="hover:underline">{sanitizeUserText(d.title)}</a>{/if}
        <span class="text-ink-muted">{fmtInt(d.up)} up, {fmtInt(d.down)} down</span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="dd-body text-ink-muted">Nothing sent yet.</p>
{/if}
