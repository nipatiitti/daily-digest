<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import { Sparkline } from "#lib/charts/index.ts"
import Delta from "#lib/components/Delta.svelte"
import { fmtTime } from "#lib/components/format.ts"
import SegmentedControl from "#lib/components/SegmentedControl.svelte"
import { page } from "$app/state"
import { storyRows, threadRows } from "./threads.remote.ts"

const provisional = $derived(page.url.searchParams.get("provisional") === "1")
const view = $derived(page.url.searchParams.get("view") === "stories" ? "stories" : provisional ? "all" : "shown")
const options = [
  { value: "shown", label: "Active", href: "/threads" },
  { value: "all", label: "With provisional", href: "/threads?provisional=1" },
  { value: "stories", label: "Stories", href: "/threads?view=stories" },
]
</script>

<svelte:head>
  <title>Threads</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <header class="flex flex-wrap items-end justify-between gap-6">
    <h1 class="dd-display">Threads</h1>
    <SegmentedControl label="Threads shown" {options} value={view} />
  </header>

  {#if view === "stories"}
    <svelte:boundary>
      {@const rows = await storyRows()}
      {#if rows.length}
        <ol class="grid divide-y divide-line">
          {#each rows as s (s.id)}
            <li class="grid gap-1 py-4">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="dd-tick">STY-{s.id}</span>
                {#if s.status !== "active"}<span class="dd-label">{s.status}</span>{/if}
                <span class="dd-tick">{s.threadCount} {s.threadCount === 1 ? "thread" : "threads"}</span>
                <time class="dd-tick" datetime={new Date(s.lastSeen).toISOString()}>{fmtTime(s.lastSeen)}</time>
              </div>
              <h2 class="dd-heading">{sanitizeUserText(s.name)}</h2>
              <p class="dd-body text-pretty text-ink-muted">{sanitizeUserText(s.description)}</p>
              {#if s.threads.length}
                <p class="dd-label text-ink-subtle">{s.threads.map(sanitizeUserText).join(", ")}</p>
              {/if}
            </li>
          {/each}
        </ol>
      {:else}
        <p class="dd-body text-ink-muted">No stories yet.</p>
      {/if}
      {#snippet pending()}
        <p class="dd-label py-6">Loading</p>
      {/snippet}
      {#snippet failed()}
        <p class="dd-label py-6 text-ink-muted">Could not load stories</p>
      {/snippet}
    </svelte:boundary>
  {:else}
  <svelte:boundary>
    {@const rows = await threadRows(provisional)}
    {#if rows.length}
      <ol class="grid divide-y divide-line">
        {#each rows as t (t.id)}
          <li class="grid gap-1 py-4">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <a href="/threads/{t.id}" class="dd-tick hover:text-ink">THR-{t.id}</a>
              {#if t.status !== "active"}<span class="dd-label">{t.status}</span>{/if}
              <Delta pct={t.momentum24h} suffix="24h" />
              <Delta pct={t.momentum7d} suffix="7d" />
              <time class="dd-tick" datetime={new Date(t.lastSeen).toISOString()}>{fmtTime(t.lastSeen)}</time>
              {#if t.storyName}<span class="dd-label">{sanitizeUserText(t.storyName)}</span>{/if}
              <span class="ml-auto">
                <Sparkline values={t.spark} stream="other" width={96} height={24} label="{t.name}, articles per hour" />
              </span>
            </div>
            <h2 class="dd-heading"><a href="/threads/{t.id}" class="hover:underline">{sanitizeUserText(t.name)}</a></h2>
            <p class="dd-body text-pretty text-ink-muted">{sanitizeUserText(t.description)}</p>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="dd-body text-ink-muted">No threads yet.</p>
    {/if}
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load threads</p>
    {/snippet}
  </svelte:boundary>
  {/if}
</div>
