<script lang="ts">
import { EDITION_LABEL, parseEditionKey } from "@digest/core"
import { fmtInt, fmtTime, padId } from "#lib/components/index.ts"
import { page } from "$app/state"
import { edition } from "../digest.remote.ts"

/** The edition key (editionKey): the bare date for the morning edition, date-afternoon for the afternoon one. */
const key = $derived(page.params.date ?? "")
const parsed = $derived(parseEditionKey(key))
const title = $derived(parsed ? `${parsed.date} ${EDITION_LABEL[parsed.edition]}` : key)
const score = (n: number | null) => (n === null ? "none" : n.toFixed(1))
</script>

<svelte:head>
  <title>Digest {title}</title>
</svelte:head>

{#snippet meta(r: { storyId: number; sentAt: number; scoreAtSend: number | null; up: number; down: number })}
  <p class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 text-ink-muted">
    <a href="/stories/{r.storyId}" class="dd-tick">{padId("STY", r.storyId)}</a>
    <span class="dd-tick whitespace-nowrap">{fmtTime(r.sentAt)}</span>
    <span>Score at send {score(r.scoreAtSend)}</span>
    <span>{fmtInt(r.up)} up, {fmtInt(r.down)} down</span>
  </p>
{/snippet}

<div class="grid gap-8 pt-8">
  <header class="grid gap-2">
    <a href="/digest" class="dd-label hover:underline">Digest</a>
    <h1 class="dd-display">{title}</h1>
  </header>

  <svelte:boundary>
    {@const e = await edition(key)}
    <!--
      The HTML is renderDigestItem's own, as Telegram shows it: every text is escaped there, and each link is a stored
      canonical http(s) URL, which the URL parser serializes without quotes.
    -->
    {#if e.header}
      <section class="grid max-w-prose gap-4">
        <p class="dd-body whitespace-pre-line">{@html e.header}</p>
        <ol class="grid gap-4">
          {#each e.items as r (r.storyId)}
            <li class="grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-sm">
              <p class="dd-body whitespace-pre-line [&_a]:underline">{@html r.html}</p>
              {@render meta(r)}
            </li>
          {/each}
        </ol>
      </section>
    {:else}
      <p class="dd-body text-ink-muted">No digest stories went out in this edition.</p>
    {/if}
    <section class="grid max-w-prose gap-4">
      <h2 class="dd-label">Alerts sent this day</h2>
      {#if e.alerts === null}
        <p class="dd-body text-ink-muted">
          Alerts are listed once a day, on the <a href="/digest/{e.date}" class="underline">morning edition</a>.
        </p>
      {:else if e.alerts.length}
        <ul class="grid divide-y divide-line">
          {#each e.alerts as r (r.storyId)}
            <li class="grid gap-1 py-2">
              <p class="dd-body-sm"><span class="font-semibold">Alert:</span> {r.title}</p>
              {@render meta(r)}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dd-body text-ink-muted">No alerts.</p>
      {/if}
    </section>
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load this edition</p>
    {/snippet}
  </svelte:boundary>
</div>
