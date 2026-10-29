<script lang="ts">
import { fmtInt } from "#lib/components/index.ts"
import { tableIndex } from "./data.remote.ts"

const tables = $derived(await tableIndex())
</script>

<svelte:head>
  <title>Data</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <h1 class="dd-display">Data</h1>
  <table class="dd-body-sm w-full max-w-xl text-left">
    <thead class="dd-label">
      <tr>
        <th class="py-2 pr-4">Table</th>
        <th class="py-2 text-right">Rows</th>
      </tr>
    </thead>
    <tbody>
      {#each tables as t (t.name)}
        <tr class="border-t border-line">
          <td class="py-2 pr-4"><a href="/data/{t.name}" class="dd-tick">{t.name}</a></td>
          <td class="dd-data text-right">{fmtInt(t.rows)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
