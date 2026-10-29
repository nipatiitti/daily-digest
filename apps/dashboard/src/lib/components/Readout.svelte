<script lang="ts">
import type { Snippet } from "svelte"
import { fmtInt } from "./format.ts"

type Props = {
  label: string
  value: string | number
  unit?: string
  /** The change and what it compares against, such as a Delta and "since yesterday". */
  foot?: Snippet
  href?: string
}

let { label, value, unit, foot, href }: Props = $props()
</script>

{#snippet tile()}
  <article
    class="grid min-w-50 gap-2 rounded-md border border-line bg-surface px-5 pt-5 pb-4 group-hover:border-line-strong"
  >
    <h3 class="dd-label">{label}</h3>
    <div class="dd-readout-xl flex items-baseline gap-1 text-ink">
      {typeof value === "number" ? fmtInt(value) : value}
      {#if unit}<span class="text-xl/none tracking-normal text-ink-subtle">{unit}</span>{/if}
    </div>
    {#if foot}
      <div class="dd-body-sm flex flex-wrap items-center gap-2 text-ink-muted">{@render foot()}</div>
    {/if}
    <div class="ruler mt-2" aria-hidden="true"></div>
  </article>
{/snippet}

{#if href}
  <a {href} class="group block rounded-md outline-none hover:shadow-sm focus-visible:shadow-focus-ring">
    {@render tile()}
  </a>
{:else}
  {@render tile()}
{/if}

<style>
  /* Tick ruler: a minor tick every 8px, a major every 40px. */
  .ruler {
    height: 8px;
    background:
      linear-gradient(90deg, var(--color-line-control) 1px, transparent 1px) 0 100% / 40px 8px repeat-x,
      linear-gradient(90deg, var(--color-line-strong) 1px, transparent 1px) 0 100% / 8px 4px repeat-x;
  }
</style>
