<script lang="ts">
import { Sparkline } from "#lib/charts/index.ts"
import { Delta, entityHref, fmtInt, fmtTime, SearchField } from "#lib/components/index.ts"
import { page } from "$app/state"
import { entityRows } from "./entities.remote.ts"

const q = $derived(page.url.searchParams.get("q") ?? "")
</script>

<svelte:head>
  <title>Entities</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <header class="flex flex-wrap items-end justify-between gap-6">
    <h1 class="dd-display">Entities</h1>
    <div class="w-full sm:w-80">
      <SearchField name="q" placeholder="Search entities" label="Search entities" value={q} action="/entities" />
    </div>
  </header>

  <svelte:boundary>
    {@const rows = await entityRows(q)}
    {#if q}<p class="text-ink-muted">Names matching "{q}"</p>{/if}
    {#if rows.length}
      <div class="overflow-x-auto">
        <table class="dd-body-sm w-full text-left">
          <thead class="dd-label">
            <tr>
              {#each ["Name", "Kind", "Stories", "Momentum", "Articles, last 24 hours", "Last seen"] as h (h)}
                <th class="py-2 pr-4">{h}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as e (e.id)}
              <tr class="border-t border-line align-middle">
                <td class="py-2 pr-4">
                  <a href={entityHref(e.key)} class="font-semibold hover:underline">{e.name}</a>
                </td>
                <td class="dd-tick pr-4">{e.kind}</td>
                <td class="dd-data pr-4">{fmtInt(e.storyCount)}</td>
                <td class="pr-4"><Delta pct={e.momentum24h} suffix="24h" /></td>
                <td class="pr-4">
                  <Sparkline
                    values={e.spark}
                    stream="other"
                    width={96}
                    height={24}
                    label="{e.name}, articles per hour"
                  />
                </td>
                <td class="dd-tick whitespace-nowrap">{fmtTime(e.lastSeen)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="dd-body text-ink-muted">No entities match.</p>
    {/if}
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load entities</p>
    {/snippet}
  </svelte:boundary>
</div>
