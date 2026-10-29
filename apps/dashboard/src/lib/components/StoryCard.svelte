<script lang="ts">
import type { Category } from "@digest/db"
import type { Snippet } from "svelte"
import { fmtInt, fmtTime } from "./format.ts"
import SeverityBadge from "./SeverityBadge.svelte"
import StreamTag from "./StreamTag.svelte"

type Props = {
  id: number
  stream: Category
  score: number | null
  /** Unix ms of the last update. */
  updatedAt: number
  /** Sentence case, states what happened, no full stop. */
  title: string
  /** At most two sentences. */
  summary: string
  /** Two to four vital numbers. */
  stats: { name: string; value: string | number }[]
  /** The one most important story on the page. */
  lead?: boolean
  momentum?: Snippet
  chips?: Snippet
  facts?: Snippet
}

let { id, stream, score, updatedAt, title, summary, stats, lead = false, momentum, chips, facts }: Props = $props()
</script>

<article
  class={[
    "relative grid gap-3 border border-line bg-surface transition hover:border-line-strong hover:shadow-md focus-within:shadow-focus-ring",
    lead ? "rounded-xl p-8 shadow-md" : "rounded-lg p-6 shadow-sm",
  ]}
>
  <header class="flex flex-wrap items-center gap-2">
    <StreamTag {stream} />
    <SeverityBadge {score} />
    {@render momentum?.()}
    <time class="dd-tick ml-auto" datetime={new Date(updatedAt).toISOString()}>{fmtTime(updatedAt)}</time>
  </header>
  <h3 class={["mt-1 text-balance", lead ? "dd-title" : "dd-heading"]}>
    <a href="/stories/{id}" class="outline-none after:absolute after:inset-0 after:rounded-[inherit]">{title}</a>
  </h3>
  <p class={["text-pretty text-ink-muted", lead ? "max-w-[62ch] text-base/[26px]" : "dd-body"]}>{summary}</p>
  <!-- Positioned so links inside sit above the stretched title link. -->
  {#if chips}
    <div class="relative flex flex-wrap gap-3">{@render chips()}</div>
  {/if}
  <dl class="mt-2 grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-4 border-t border-line pt-4">
    {#each stats as stat (stat.name)}
      <div class="grid content-start gap-0.5">
        <dt class="dd-label">{stat.name}</dt>
        <dd class="font-mono text-[15px]/6 font-medium">
          {typeof stat.value === "number" ? fmtInt(stat.value) : stat.value}
        </dd>
      </div>
    {/each}
  </dl>
  {#if facts}
    <div class="relative">{@render facts()}</div>
  {/if}
</article>
