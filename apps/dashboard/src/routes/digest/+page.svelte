<script lang="ts">
import { fmtInt } from "#lib/components/index.ts"
import { page } from "$app/state"
import { editionPage } from "./digest.remote.ts"

const pageNo = $derived(Math.max(1, Math.floor(Number(page.url.searchParams.get("page"))) || 1))
</script>

<svelte:head>
  <title>Digest</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <h1 class="dd-display">Digest</h1>

  <svelte:boundary>
    {@const list = await editionPage(pageNo)}
    {#if list.rows.length}
      <ol class="grid max-w-prose divide-y divide-line">
        {#each list.rows as e (e.date)}
          <li class="dd-body-sm flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3">
            <a href="/digest/{e.date}" class="dd-tick hover:underline">{e.date}</a>
            <span>{fmtInt(e.items)} {e.items === 1 ? "story" : "stories"}</span>
            <span class="text-ink-muted">{fmtInt(e.up)} up, {fmtInt(e.down)} down</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="dd-body text-ink-muted">No digest went out on these days.</p>
    {/if}
    {#if pageNo > 1 || list.more}
      <nav class="dd-body-sm flex gap-6" aria-label="Pages">
        {#if pageNo > 1}<a href="?page={pageNo - 1}" class="hover:underline">Newer</a>{/if}
        {#if list.more}<a href="?page={pageNo + 1}" class="hover:underline">Older</a>{/if}
      </nav>
    {/if}
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load the digest archive</p>
    {/snippet}
  </svelte:boundary>
</div>
