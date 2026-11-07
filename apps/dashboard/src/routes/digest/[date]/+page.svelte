<script lang="ts">
import { EDITION_LABEL, parseEditionKey, sanitizeUserText } from "@digest/core"
import { fmtInt, fmtTime } from "#lib/components/format.ts"
import { page } from "$app/state"
import { edition } from "../digest.remote.ts"

/** The edition key (editionKey): the bare date for the morning edition, date-afternoon for the afternoon one. */
const key = $derived(page.params.date ?? "")
const parsed = $derived(parseEditionKey(key))
const title = $derived(parsed ? `${parsed.date} ${EDITION_LABEL[parsed.edition]}` : key)
const MODES: Record<string, string> = { send: "As sent", replay: "Replay" }
/** Why a candidate stayed out, as the "Held back" list says it. */
const OUTCOMES: Record<string, string> = {
  uncoded: "Not coded",
  muted: "Muted",
  talk: "Only talk",
  below_bar: "Below the bar",
  no_change: "No change in the story",
  minor_change: "Minor change only",
  not_judged: "Change not judged",
  not_carried: "Not part of the story's change",
  copy_skip: "Copy found only talk",
  over_max: "Edition full",
}
const card = "grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-sm"
</script>

<svelte:head>
  <title>Digest {title}</title>
</svelte:head>

{#snippet meta(r: { eventId: number; sentAt: number; up: number; down: number; gate?: number | null })}
  <p class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 text-ink-muted">
    <a href="/events/{r.eventId}" class="dd-tick hover:underline">EVT-{r.eventId}</a>
    {#if r.gate}<span>Gate {r.gate}</span>{/if}
    <span class="dd-tick whitespace-nowrap">{fmtTime(r.sentAt)}</span>
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
      The HTML is what Telegram shows, renderDigestHeader's or renderEmptyDigest's for the header and renderDigestItem's
      stored with each replayed item. Every text is escaped there, and each link is a stored canonical http(s) URL, which
      the URL parser serializes without quotes.
    -->
    <div class="grid gap-8 lg:auto-cols-fr lg:grid-flow-col">
      <section class="grid content-start gap-4">
        <h2 class="dd-label">Sent</h2>
        <p class="dd-body whitespace-pre-line">{@html e.header}</p>
        {#if e.events.length}
          <ol class="grid gap-4">
            {#each e.events as r (`${r.kind}${r.eventId}`)}
              <li class={card}>
                <p class="dd-body font-semibold">
                  {r.kind === "update" || r.isUpdate ? "Update: " : ""}{r.storyName
                    ? `${sanitizeUserText(r.storyName)}: `
                    : ""}{sanitizeUserText(r.headline)}
                </p>
                <p class="dd-body">{sanitizeUserText(r.summary)}</p>
                {@render meta(r)}
              </li>
            {/each}
          </ol>
        {/if}
      </section>
      {#if e.replay.length}
        <section class="grid content-start gap-4">
          <h2 class="dd-label">Replay, as of {fmtTime(e.replay[0]?.asOf ?? 0)}</h2>
          <ol class="grid gap-4">
            {#each e.replay as r (r.rank)}
              <li class={card}>
                <p class="dd-body whitespace-pre-line [&_a]:underline">{@html r.text}</p>
                <p class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 text-ink-muted">
                  <span class="dd-tick">{r.rank}</span>
                  <a href="/events/{r.eventId}" class="dd-tick hover:underline">EVT-{r.eventId}</a>
                  <span>Gate {r.gate}, score {r.score.toFixed(2)}</span>
                </p>
              </li>
            {/each}
          </ol>
        </section>
      {/if}
    </div>
    {#each e.held as m (m.mode)}
      <section class="grid gap-4">
        <h2 class="dd-label">Held back{e.held.length > 1 ? `, ${MODES[m.mode]}` : ""}</h2>
        <ul class="grid divide-y divide-line">
          {#each m.rows as j (j.eventId)}
            <li class="grid gap-1 py-3">
              <p class="dd-body-sm">
                <a href="/events/{j.eventId}" class="font-semibold hover:underline">{sanitizeUserText(j.title)}</a>
                {#if j.storyName}<span class="dd-label">{sanitizeUserText(j.storyName)}</span>{/if}
              </p>
              <p class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 text-ink-muted">
                <span class="font-medium text-ink">{OUTCOMES[j.outcome] ?? j.outcome}</span>
                {#if j.significance !== null}<span>Significance {j.significance}</span>{/if}
                {#if j.act}<span>{j.act.replaceAll("_", " ")}{j.material ? "" : ", talk"}</span>{/if}
                {#if j.interest}<span>Interest {j.interest}</span>{/if}
                {#if j.gate !== null}<span>Gate {j.gate}</span>{/if}
                {#if j.change}<span>Change {j.change}</span>{/if}
              </p>
              {#if j.reason}<p class="dd-body-sm text-pretty text-ink-muted">{sanitizeUserText(j.reason)}</p>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    <section class="grid max-w-prose gap-4">
      <h2 class="dd-label">Alerts sent this day</h2>
      {#if e.alerts === null}
        <p class="dd-body text-ink-muted">
          Alerts are listed once a day, on the <a href="/digest/{e.date}" class="underline">morning edition</a>.
        </p>
      {:else if e.alerts.length}
        <ul class="grid divide-y divide-line">
          {#each e.alerts as r (r.eventId)}
            <li class="grid gap-1 py-2">
              <p class="dd-body-sm"><span class="font-semibold">Alert:</span> {sanitizeUserText(r.headline)}</p>
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
