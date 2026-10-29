<script lang="ts">
import { fmtTime, idSegments } from "#lib/components/index.ts"
import { page } from "$app/state"
import { briefPage } from "./briefs.remote.ts"

const pageNo = $derived(Math.max(1, Math.floor(Number(page.url.searchParams.get("page"))) || 1))
</script>

<svelte:head>
  <title>Briefs</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <h1 class="dd-display">Briefs</h1>

  <svelte:boundary>
    {@const list = await briefPage(pageNo)}
    {#if list.rows.length}
      <ol class="grid max-w-prose divide-y divide-line">
        {#each list.rows as b (b.id)}
          <li class="grid gap-1 py-4">
            <time class="dd-tick" datetime={new Date(b.at).toISOString()}>{fmtTime(b.at)}</time>
            <!-- Svelte trims the whitespace around each block's content, so ids and text join as written. -->
            <p class="dd-body text-pretty">
              {#each idSegments(b.text) as s, i (i)}
                {#if s.href}
                  <a href={s.href} class="font-mono hover:underline">{s.text}</a>
                {:else}
                  {s.text}
                {/if}
              {/each}
            </p>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="dd-body text-ink-muted">No briefs in these hours.</p>
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
      <p class="dd-label py-6 text-ink-muted">Could not load briefs</p>
    {/snippet}
  </svelte:boundary>
</div>
