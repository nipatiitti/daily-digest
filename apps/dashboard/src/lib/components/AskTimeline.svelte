<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import { askTimeline } from "./ask.remote.ts"
import { fmtDay, fmtInt } from "./format.ts"

/** The event ids an answer cites, in any order; the timeline lists them first seen first. */
let { ids }: { ids: number[] } = $props()

const items = $derived(await askTimeline(ids))
</script>

{#if items.length}
  <section aria-labelledby="ask-timeline" class="grid max-w-prose gap-2">
    <h3 id="ask-timeline" class="dd-label">Timeline</h3>
    <ol class="grid">
      {#each items as e (e.id)}
        <li class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-0.5 border-t border-line py-3 first:border-t-0">
          <time class="row-span-2 font-mono text-[11px]/[22px] text-ink-subtle" datetime={new Date(e.firstSeen).toISOString()}>
            {fmtDay(e.firstSeen)}
          </time>
          <a
            href="/events/{e.id}"
            class="text-[15px]/[22px] font-medium break-words text-ink hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-3"
          >
            {sanitizeUserText(e.title)}
          </a>
          <p class="dd-body-sm flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
            {#if e.thread}
              <a href="/threads/{e.thread.id}" class="font-semibold text-ink hover:underline">
                {sanitizeUserText(e.thread.name)}
              </a>
            {/if}
            {#if e.independentOrigins > 0}
              <span>{fmtInt(e.independentOrigins)} {e.independentOrigins === 1 ? "independent outlet" : "independent outlets"}</span>
            {/if}
            {#if e.outlets.length}<span>{e.outlets.join(", ")}</span>{/if}
          </p>
        </li>
      {/each}
    </ol>
  </section>
{/if}
