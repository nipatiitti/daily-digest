<script lang="ts">
import { Button, SearchField } from "#lib/components/index.ts"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import Cell, { choices } from "../Cell.svelte"
import { browse } from "../data.remote.ts"

const table = $derived(page.params.table ?? "")
const params = $derived(page.url.searchParams)
const b = $derived(await browse({ table, search: page.url.search }))
const sort = $derived(params.get("sort") ?? b.meta.primaryKey[0])
const dir = $derived(params.get("dir") === "asc" ? "asc" : "desc")
const input =
  "h-(--size-control-sm) w-full min-w-24 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"
const BOUNDS = [
  { op: "gte", word: "From" },
  { op: "lte", word: "To" },
]

/** This URL with `changes` applied, null deleting a key; any change but `after` starts again at the first page. */
const href = (changes: Record<string, string | null>) => {
  const p = new URLSearchParams(page.url.search)
  if (!("after" in changes)) p.delete("after")
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) p.delete(k)
    else p.set(k, v)
  }
  return `?${p}`
}

/** Submits only the filled-in fields, so the URL stays short enough to share. */
const apply = (e: SubmitEvent & { currentTarget: HTMLFormElement }) => {
  e.preventDefault()
  const p = new URLSearchParams()
  for (const [k, v] of new FormData(e.currentTarget)) {
    if (typeof v === "string" && v.trim()) p.set(k, v.trim())
  }
  goto(`?${p}`)
}
</script>

<svelte:head>
  <title>{table}</title>
</svelte:head>

<div class="grid gap-6 pt-8">
  <header class="grid gap-4">
    <a href="/data" class="dd-label">Data</a>
    <h1 class="dd-display">{table}</h1>
    <form id="filters" method="get" onsubmit={apply} class="flex flex-wrap items-center gap-3">
      {#if b.meta.fts}
        <div class="w-full max-w-md">
          <SearchField
            name="q"
            value={params.get("q") ?? ""}
            placeholder={`Search ${b.meta.fts.columns.join(", ").replaceAll("_", " ")}`}
            label="Search {table}"
          />
        </div>
      {/if}
      {#each ["sort", "dir"] as k (k)}
        {#if params.get(k)}<input type="hidden" name={k} value={params.get(k)} />{/if}
      {/each}
      <Button type="submit" size="sm">Apply filters</Button>
      <Button href="/data/{table}" size="sm" variant="ghost">Clear</Button>
      <Button href="/data/{table}/export{page.url.search}" size="sm" variant="ghost" data-sveltekit-reload>
        Download CSV
      </Button>
    </form>
  </header>

  <div class="overflow-x-auto">
    <table class="dd-body-sm w-full text-left">
      <thead>
        <tr class="dd-label">
          <th class="py-2 pr-4">Row</th>
          {#each b.meta.columns as c (c.name)}
            <th
              class="py-2 pr-4 whitespace-nowrap"
              aria-sort={sort === c.name ? (dir === "asc" ? "ascending" : "descending") : undefined}
            >
              <a href={href({ sort: c.name, dir: sort === c.name && dir === "asc" ? "desc" : "asc" })}>
                {c.name}{sort === c.name ? (dir === "asc" ? " ↑" : " ↓") : ""}
              </a>
            </th>
          {/each}
        </tr>
        <tr>
          <th></th>
          {#each b.meta.columns as c (c.name)}
            <th class="pr-2 pb-2 align-top font-normal">
              {#if choices(c).length}
                <select name="{c.name}.eq" form="filters" class={input} aria-label="{c.name} equals">
                  <option value="">Any</option>
                  {#each choices(c) as v (v)}
                    <option value={v} selected={params.get(`${c.name}.eq`) === v}>{v}</option>
                  {/each}
                </select>
              {:else if c.kind === "text" || c.kind === "json"}
                <input
                  name="{c.name}.contains"
                  value={params.get(`${c.name}.contains`) ?? ""}
                  placeholder="Contains"
                  form="filters"
                  class={input}
                  aria-label="{c.name} contains"
                />
              {:else}
                <div class="grid gap-1">
                  {#each BOUNDS as { op, word } (op)}
                    <input
                      name="{c.name}.{op}"
                      value={params.get(`${c.name}.${op}`) ?? ""}
                      placeholder={word}
                      title={c.kind === "timestamp" ? "UTC, as 2026-10-27T06:12Z or unix ms" : undefined}
                      form="filters"
                      class={input}
                      aria-label="{c.name} {word}"
                    />
                  {/each}
                </div>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each b.rows as r (r.id)}
          <tr class="border-t border-line align-top">
            <td class="py-2 pr-4">
              <a href="/data/{table}/{encodeURIComponent(r.id)}" class="dd-tick">{r.id}</a>
            </td>
            {#each b.meta.columns as c (c.name)}
              <td class="max-w-80 truncate py-2 pr-4">
                <Cell value={r.values[c.name]} kind={c.kind} link={b.meta.linksTo[c.name]} />
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !b.rows.length}<p class="dd-body text-ink-muted">No rows match.</p>{/if}

  <nav class="flex flex-wrap gap-3" aria-label="Pages">
    {#if params.has("after")}<Button href={href({ after: null })} size="sm">First page</Button>{/if}
    {#if b.next}<Button href={href({ after: b.next })} size="sm">Next</Button>{/if}
  </nav>
</div>
