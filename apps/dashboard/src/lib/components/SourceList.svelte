<script lang="ts">
import { fmtTime } from "./format.ts"

type Source = {
  id: number
  /** As published. */
  title: string
  href: string
  /** Unix ms. */
  at: number
  outlet: string
  /** Marks the first report, or describes the piece: Explainer, Analysis. */
  role?: string
}

/** Oldest first. */
let { items }: { items: Source[] } = $props()
</script>

<ol class="grid">
  {#each items as item, i (item.id)}
    <li class="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-t border-line py-3 first:border-t-0">
      <span class="row-span-2 font-mono text-[11px]/[22px] text-ink-subtle" aria-hidden="true">
        {String(i + 1).padStart(2, "0")}
      </span>
      <a
        href={item.href}
        class="text-[15px]/[22px] font-medium break-words text-ink hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-3"
      >
        {item.title}
      </a>
      <time class="font-mono text-[11px]/[22px] text-ink-subtle" datetime={new Date(item.at).toISOString()}>
        {fmtTime(item.at)}
      </time>
      <p class="dd-body-sm col-span-2 col-start-2 flex flex-wrap items-center gap-3 text-ink-muted">
        <span class="font-semibold text-ink">{item.outlet}</span>
        {#if item.role}
          <span
            class="rounded-full bg-amber-soft px-2 py-px font-mono text-[10px]/4 font-semibold tracking-[0.08em] text-amber-ink uppercase"
          >
            {item.role}
          </span>
        {/if}
      </p>
    </li>
  {/each}
</ol>
