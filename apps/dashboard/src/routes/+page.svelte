<script lang="ts">
import { sanitizeUserText } from "@digest/core"
import { Sparkline } from "#lib/charts/index.ts"
import AskDesk from "#lib/components/AskDesk.svelte"
import Delta from "#lib/components/Delta.svelte"
import EventItem from "#lib/components/EventItem.svelte"
import { fmtTime } from "#lib/components/format.ts"
import type { PageProps } from "./$types"
import { sinceLastLook, todaysEditions, topMovers } from "./home.remote.ts"

let { data }: PageProps = $props()

const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date())
</script>

<svelte:head>
  <title>Home</title>
</svelte:head>

{#snippet loading()}
  <p class="dd-label py-6">Loading</p>
{/snippet}

{#snippet failed()}
  <p class="dd-label py-6 text-ink-muted">Could not load this block</p>
{/snippet}

{#snippet items(label: string, rows: { eventId: number | null; title: string }[])}
  <div class="grid content-start gap-2">
    <h4 class="dd-label">{label}</h4>
    {#if rows.length}
      <ol class="dd-body grid list-decimal gap-2 pl-5">
        {#each rows as r, i (i)}
          <li>
            {#if r.eventId}
              <a href="/events/{r.eventId}" class="hover:underline">{sanitizeUserText(r.title)}</a>
            {:else}
              {sanitizeUserText(r.title)}
            {/if}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="dd-body-sm text-ink-muted">Not sent yet.</p>
    {/if}
  </div>
{/snippet}

<div class="grid gap-10 pt-8">
  <header class="grid gap-6">
    <h1 class="dd-display">{today}</h1>
    <AskDesk />
  </header>

  <section class="grid gap-4">
    <h2 class="dd-label">
      Since you last looked, <time datetime={new Date(data.since).toISOString()}>{fmtTime(data.since)}</time>
    </h2>
    <svelte:boundary pending={loading} {failed}>
      {@const s = await sinceLastLook(data.since)}
      {#if s.events.length}
        <ol class="grid">
          {#each s.events as e (e.id)}<EventItem event={e} via={e.via} />{/each}
        </ol>
      {:else if s.follows}
        <p class="dd-body text-ink-muted">Nothing new in what you follow.</p>
      {:else}
        <p class="dd-body text-ink-muted">Follow a thread, an entity or a country from its page to see its news here.</p>
      {/if}
    </svelte:boundary>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label"><a href="/threads" class="hover:text-ink">Moving now</a></h2>
    <svelte:boundary pending={loading} {failed}>
      {@const movers = await topMovers()}
      {#if movers.length}
        <ol class="grid gap-4 md:grid-cols-2">
          {#each movers as m (`${m.kind}:${m.key}`)}
            <li class="grid content-start gap-2 rounded-lg border border-line bg-surface p-5 shadow-sm">
              <div class="flex flex-wrap items-center gap-2">
                <span class="dd-label">{m.kind}</span>
                <Delta pct={m.change24h} suffix="24h" />
                <Delta pct={m.change7d} suffix="7d" />
                <span class="ml-auto">
                  <Sparkline
                    values={m.spark}
                    stream="other"
                    width={96}
                    height={24}
                    label="{m.name}, articles per hour, last day"
                  />
                </span>
              </div>
              <h3 class="dd-heading"><a href={m.href} class="hover:underline">{sanitizeUserText(m.name)}</a></h3>
              {#if m.reason}<p class="dd-body text-pretty text-ink-muted">{sanitizeUserText(m.reason)}</p>{/if}
            </li>
          {/each}
        </ol>
      {:else}
        <p class="dd-body text-ink-muted">Nothing is moving yet.</p>
      {/if}
    </svelte:boundary>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label"><a href="/digest" class="hover:text-ink">Today's editions</a></h2>
    <svelte:boundary pending={loading} {failed}>
      {#each await todaysEditions() as ed (ed.key)}
        <article class="grid gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h3 class="dd-heading"><a href="/digest/{ed.key}" class="hover:underline">{ed.label}</a></h3>
          <div class="grid gap-6 md:grid-cols-2">
            {@render items("As sent", ed.sent)}
            {#if ed.replay.length}{@render items("Replay", ed.replay)}{/if}
          </div>
        </article>
      {:else}
        <p class="dd-body text-ink-muted">No edition yet today.</p>
      {/each}
    </svelte:boundary>
  </section>
</div>
