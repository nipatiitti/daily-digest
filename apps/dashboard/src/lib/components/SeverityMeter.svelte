<script lang="ts">
import type { Snippet } from "svelte"
import { SEVERITY_FILLS, SEVERITY_WORDS, type SeverityLevel } from "./severity.ts"

type Props = {
  /** Names the scope, such as "Threat level, Security". */
  label: string
  level: SeverityLevel
  /** One sentence naming the cause and the change. */
  note: string
  /** Usually a StatusLamp. */
  lamp?: Snippet
}

let { label, level, note, lamp }: Props = $props()

const id = $props.id()
</script>

<section aria-labelledby={id} class="grid gap-5 rounded-lg border border-line bg-surface p-6 shadow-sm">
  <header class="flex items-center justify-between gap-4">
    <h2 {id} class="dd-label">{label}</h2>
    {@render lamp?.()}
  </header>
  <div class="flex flex-wrap items-baseline gap-3">
    <span class="dd-title">{SEVERITY_WORDS[level - 1]}</span>
    <span class="dd-data text-ink-subtle">Level {level} of 5</span>
  </div>
  <ol class="grid grid-cols-5 gap-1">
    {#each SEVERITY_WORDS as word, i (word)}
      <li class="grid min-w-0 gap-2" data-lit={i < level || undefined} aria-current={i === level - 1 ? "step" : undefined}>
        <span
          class={[
            "h-3.5 rounded-full",
            i < level ? SEVERITY_FILLS[i] : "bg-line-strong opacity-55",
            i === level - 1 && "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
          ]}
        ></span>
        <span class={["dd-tick truncate tracking-[0.06em] uppercase", i === level - 1 && "font-semibold text-ink"]}>
          {word}
        </span>
      </li>
    {/each}
  </ol>
  <p class="dd-body-sm text-ink-muted">{note}</p>
</section>
