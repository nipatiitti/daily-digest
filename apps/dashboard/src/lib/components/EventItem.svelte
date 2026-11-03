<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import type { ReaderEvent } from "@digest/db"
import { fmtTime } from "./format.ts"

type Props = {
  event: Pick<ReaderEvent, "id" | "title" | "gist" | "firstSeen" | "score" | "reason">
  /** The followed threads, entities and countries it belongs to, by name. */
  via?: string[]
}

let { event: e, via = [] }: Props = $props()
</script>

<li class="grid gap-1 border-t border-line py-4 first:border-t-0">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <a href="/events/{e.id}" class="dd-tick hover:text-ink">EVT-{e.id}</a>
    <time class="dd-tick" datetime={new Date(e.firstSeen).toISOString()}>{fmtTime(e.firstSeen)}</time>
    {#each via as v (v)}<span class="dd-label">{v}</span>{/each}
    {#if e.score !== null}<span class="dd-tick ml-auto">Relevance {e.score}</span>{/if}
  </div>
  <h3 class="dd-heading text-balance">
    <a href="/events/{e.id}" class="hover:underline">{sanitizeUserText(e.title)}</a>
  </h3>
  <p class="dd-body text-pretty text-ink-muted">{sanitizeUserText(e.gist)}</p>
  {#if e.reason}<p class="dd-body-sm text-pretty text-ink-muted">{sanitizeUserText(e.reason)}</p>{/if}
</li>
