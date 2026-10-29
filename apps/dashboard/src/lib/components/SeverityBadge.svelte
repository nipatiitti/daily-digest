<script lang="ts">
import { SEVERITY_FILLS, SEVERITY_WORDS, severityLevel } from "./severity.ts"

let { score }: { score: number | null } = $props()

const level = $derived(severityLevel(score))
</script>

<span
  data-level={level}
  class={[
    "inline-flex h-7 items-center gap-2 rounded-full border bg-surface pr-3 pl-2.5 font-mono text-[11px]/4 font-semibold tracking-[0.08em] whitespace-nowrap uppercase",
    level === 5 ? "border-sev-critical text-sev-critical" : "border-line-strong text-ink",
  ]}
>
  <span class="inline-flex items-end gap-0.5" aria-hidden="true">
    {#each SEVERITY_FILLS as fill, i (fill)}
      <i class={["block h-3 w-1 rounded-[2px]", i < level ? SEVERITY_FILLS[level - 1] : "bg-line-strong"]}></i>
    {/each}
  </span>
  {SEVERITY_WORDS[level - 1]}
</span>
