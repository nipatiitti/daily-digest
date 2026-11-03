<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import type { MoverKind } from "@digest/db"
import { TrendChart } from "#lib/charts/index.ts"
import Button from "./Button.svelte"
import DeliveryList from "./DeliveryList.svelte"
import Delta from "./Delta.svelte"
import EventItem from "./EventItem.svelte"
import LinkChip from "./LinkChip.svelte"
import { follow, subjectPage } from "./subject.remote.ts"

/** A thread by ID, an entity by key or a country by ISO code. */
let { kind, key }: { kind: MoverKind; key: string } = $props()

const p = $derived(await subjectPage({ kind, key }))
let saving = $state(false)
let failed = $state(false)

const toggle = async () => {
  saving = true
  failed = false
  try {
    await follow({ kind, key, on: !p.following })
  } catch {
    failed = true
  } finally {
    saving = false
  }
}
</script>

<svelte:head>
  <title>{p.name}</title>
</svelte:head>

<div class="grid gap-10 pt-8">
  <header class="grid gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="dd-tick">{p.tick}</span>
      <span class="dd-label">{p.label}</span>
      <Delta pct={p.volume.change24h} suffix="24h" />
      <Delta pct={p.volume.change7d} suffix="7d" />
      <Button size="sm" class="ml-auto" disabled={saving} onclick={toggle}>
        {p.following ? "Unfollow" : "Follow"}
      </Button>
    </div>
    <h1 class="dd-display">{sanitizeUserText(p.name)}</h1>
    {#if p.description}<p class="dd-body max-w-prose">{sanitizeUserText(p.description)}</p>{/if}
    {#if failed}<p class="dd-body-sm text-sev-high">The follow did not save. Try again.</p>{/if}
  </header>

  <section class="grid gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">Articles per hour</h2>
    <TrendChart
      labels={p.volume.labels}
      series={[{ name: "Articles", stream: "other", values: p.volume.values }]}
      projectFrom={p.volume.projectFrom}
      title="Articles per hour"
    />
  </section>

  {#each p.related as g (g.kind)}
    <section class="grid gap-4">
      <h2 class="dd-label">{g.label}</h2>
      <div class="flex flex-wrap gap-3">
        {#each g.chips as c (c.href)}<LinkChip {...c} />{/each}
      </div>
    </section>
  {/each}

  <section class="grid gap-4">
    <h2 class="dd-label">Events</h2>
    {#if p.timeline.length}
      <ol class="grid">
        {#each p.timeline as e (e.id)}<EventItem event={e} />{/each}
      </ol>
    {:else}
      <p class="dd-body text-ink-muted">No events yet.</p>
    {/if}
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Sent, with votes</h2>
    <DeliveryList items={p.deliveries} titles />
  </section>
</div>
