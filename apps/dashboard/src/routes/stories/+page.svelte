<script lang="ts">
import { Delta, fmtDate, fmtTime, SegmentedControl, StoryCard } from "#lib/components/index.ts"
import { parseRange, RANGES } from "#lib/range.ts"
import { page } from "$app/state"
import { storyList } from "./stories.remote.ts"

const params = $derived(page.url.searchParams)
const range = $derived(parseRange(params.get("range")))
const q = $derived(params.get("q") ?? undefined)
const hour = $derived(params.get("hour") ?? undefined)
const day = $derived(params.get("day") ?? undefined)
const ranges = $derived(
  RANGES.map((r) => ({
    value: r,
    label: r === "all" ? "All" : r,
    href: `?${new URLSearchParams(q ? { range: r, q } : { range: r })}`,
  })),
)
</script>

<svelte:head>
  <title>Stories</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <header class="flex flex-wrap items-end justify-between gap-6">
    <h1 class="dd-display">Stories</h1>
    <SegmentedControl label="Time range" options={ranges} value={range} />
  </header>

  <svelte:boundary>
    {@const stories = await storyList({ range, hour, day, q })}
    <!-- After the query, which rejects a malformed hour or day before it reaches the formatters. -->
    {#if hour}
      <p class="text-ink-muted">With an article in the hour from {fmtTime(Number(hour))}</p>
    {:else if day}
      <p class="text-ink-muted">With an article on {fmtDate(Number(day))}</p>
    {/if}
    {#if q}<p class="text-ink-muted">Titles containing "{q}"</p>{/if}
    {#if stories.length}
      <div class="grid gap-6 md:grid-cols-3">
        {#each stories as s (s.id)}
          <StoryCard
            id={s.id}
            stream={s.category}
            score={s.score}
            updatedAt={s.lastArticleAt}
            title={s.title}
            summary={s.summary ?? "Not evaluated yet."}
            stats={[
              { name: "Articles", value: s.articles },
              { name: "Sources", value: s.sources },
              { name: "Origins", value: s.origins },
            ]}
            themes={s.themes}
          >
            {#snippet momentum()}<Delta pct={s.momentum24h} suffix="24h" />{/snippet}
          </StoryCard>
        {/each}
      </div>
    {:else}
      <p class="dd-body text-ink-muted">No stories match.</p>
    {/if}
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load stories</p>
    {/snippet}
  </svelte:boundary>
</div>
