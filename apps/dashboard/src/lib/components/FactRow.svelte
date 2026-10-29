<script lang="ts">
import { Check, Info, TriangleAlert } from "@lucide/svelte"

type Props = {
  status: "active" | "superseded" | "contradicted"
  /** One plain declarative sentence. */
  text: string
  /** Independent sources carrying the claim. */
  sources: number
  href?: string
}

let { status, text, sources, href }: Props = $props()

const STATES = {
  active: { word: "Confirmed", Icon: Check, look: "bg-ink text-paper" },
  superseded: { word: "Superseded", Icon: Info, look: "text-ink-muted inset-ring inset-ring-line-control" },
  contradicted: { word: "Contradicted", Icon: TriangleAlert, look: "text-sev-high inset-ring inset-ring-sev-high" },
}

const state = $derived(STATES[status])
</script>

<!-- One item of an <ol>; the list divides rows with line hairlines. -->
<li
  data-status={status}
  class="grid gap-2 rounded-sm px-4 py-3.5 hover:bg-surface-sunken sm:grid-cols-[140px_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
>
  <span
    class={[
      "inline-flex h-6.5 items-center gap-1.5 justify-self-start rounded-full pr-3 pl-2 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase",
      state.look,
    ]}
  >
    <state.Icon size={14} strokeWidth={2.25} />
    {state.word}
  </span>
  <p class="text-[15px]/[22px]">
    {#if href}
      <a {href} class="underline decoration-line-strong underline-offset-3 hover:decoration-amber">{text}</a>
    {:else}
      {text}
    {/if}
  </p>
  <span class="dd-tick whitespace-nowrap">{sources} {sources === 1 ? "source" : "sources"}</span>
</li>
