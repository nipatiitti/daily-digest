<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import DeliveryList from "#lib/components/DeliveryList.svelte"
import { fmtTime } from "#lib/components/format.ts"
import LinkChip from "#lib/components/LinkChip.svelte"
import SourceList from "#lib/components/SourceList.svelte"
import { page } from "$app/state"
import { eventPage } from "./event.remote.ts"

const e = $derived(await eventPage(Number(page.params.id)))
const flags = $derived(
  [
    e.advisoryOnly && "Advisory only",
    e.flags.opinion && "Opinion",
    e.flags.roundup && "Roundup",
    e.flags.promotional && "Promotional",
  ].filter((f) => f !== false),
)
</script>

<svelte:head>
  <title>EVT-{e.id} {e.title}</title>
</svelte:head>

<div class="grid gap-10 pt-8">
  <header class="grid max-w-prose gap-4">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="dd-tick">EVT-{e.id}</span>
      <span class="dd-label">{e.eventType}</span>
      {#each flags as f (f)}<span class="dd-label">{f}</span>{/each}
      <span class="dd-tick">
        First seen <time datetime={new Date(e.firstSeen).toISOString()}>{fmtTime(e.firstSeen)}</time>, latest report
        <time datetime={new Date(e.lastArticleAt).toISOString()}>{fmtTime(e.lastArticleAt)}</time>
      </span>
    </div>
    <h1 class="dd-display text-balance">{sanitizeUserText(e.title)}</h1>
    <p class="dd-body text-pretty">{sanitizeUserText(e.gist)}</p>
    {#if e.relevance}
      <p class="dd-body-sm text-ink-muted">
        Relevance {e.relevance.score} for profile version {e.relevance.profileVersion}.
        {sanitizeUserText(e.relevance.reason)}
      </p>
    {/if}
    {#if e.code}
      {@const c = e.code}
      {@const signed = (n: number) => (n > 0 ? `+${n}` : String(n))}
      <p class="dd-body-sm text-ink-muted">
        Coded {c.act.replaceAll("_", " ")}, {c.material ? "material" : "not material"}, significance {c.significance},
        valence {signed(c.valence)}{#if c.stance !== null}, stance {signed(c.stance)}{/if}.
        {#if c.actors.length}
          {c.actors.map((a) => `${sanitizeUserText(a.name)} (${a.role})`).join(", ")}.
        {/if}
        {sanitizeUserText(c.reason)}
      </p>
    {/if}
  </header>

  {#each e.chips as g (g.label)}
    <section class="grid gap-4">
      <h2 class="dd-label">{g.label}</h2>
      <div class="flex flex-wrap gap-3">
        {#each g.chips as c (c.href)}<LinkChip {...c} />{/each}
      </div>
    </section>
  {/each}

  <section class="grid gap-6">
    <h2 class="dd-label">Reports by outlet</h2>
    {#each e.outlets as o (o.name)}
      <div class="grid gap-2 rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h3 class="dd-heading">{o.name} <span class="dd-tick">{o.role}</span></h3>
        <SourceList items={o.items} />
      </div>
    {:else}
      <p class="dd-body text-ink-muted">No reports yet.</p>
    {/each}
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Sent, with votes</h2>
    <DeliveryList items={e.deliveries} />
  </section>
</div>
