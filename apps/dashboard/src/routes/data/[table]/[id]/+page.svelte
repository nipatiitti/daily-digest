<script lang="ts">
import { Button } from "#lib/components/index.ts"
import { page } from "$app/state"
import Cell, { choices } from "../../Cell.svelte"
import { editForm, tableRow } from "../../data.remote.ts"

const table = $derived(page.params.table ?? "")
const id = $derived(page.params.id ?? "")
const r = $derived(await tableRow({ table, id }))
const input = "h-(--size-control-sm) w-56 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"

/** Columns whose change is asked about first: turning a source off, or closing or reopening a story. */
const CONFIRM = new Set(["enabled", "status"])

/** An enhance callback that submits only after the browser's confirm dialog. */
const confirmed = (question: string) => async (f: { submit: () => Promise<unknown> }) => {
  if (confirm(question)) await f.submit()
}
</script>

<svelte:head>
  <title>{table} {id}</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
  {#each list ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
{/snippet}

<div class="grid gap-8 pt-8">
  <header class="grid gap-2">
    <a href="/data/{table}" class="dd-label">{table}</a>
    <h1 class="dd-display">Row {id}</h1>
  </header>

  <dl class="grid gap-x-8 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
    {#each r.meta.columns as c (c.name)}
      {@const value = r.row[c.name]}
      <dt class="dd-label">{c.name}</dt>
      <dd class="dd-data grid min-w-0 gap-2 break-words">
        <div><Cell {value} kind={c.kind} link={r.meta.linksTo[c.name]} /></div>
        {#if r.meta.editable.includes(c.name)}
          {@const ef = editForm.for(`${id}:${c.name}`)}
          {@const options = r.meta.editableValues?.[c.name] ?? choices(c)}
          <form
            {...(CONFIRM.has(c.name) ? ef.enhance(confirmed(`Change ${c.name} on ${table} row ${id}?`)) : ef)}
            class="flex flex-wrap items-center gap-2"
          >
            <input {...ef.fields.table.as("hidden", table)} />
            <input {...ef.fields.id.as("hidden", id)} />
            <input {...ef.fields.column.as("hidden", c.name)} />
            {#if options.length}
              <select {...ef.fields.value.as("select", String(value ?? ""))} class={input} aria-label="New {c.name}">
                {#each options as v (v)}
                  <option value={v}>{v}</option>
                {/each}
              </select>
            {:else}
              <input {...ef.fields.value.as("text", String(value ?? ""))} class={input} aria-label="New {c.name}" />
            {/if}
            <Button type="submit" size="sm" variant="ghost">Save</Button>
          </form>
          {@render issues(ef.fields.allIssues())}
        {/if}
      </dd>
    {/each}
  </dl>
</div>
