<script lang="ts">
import { DASHBOARD } from "@digest/core"
import { X } from "@lucide/svelte"
import { page } from "$app/state"
import { type Stream, streamVar } from "../charts/scale.ts"
import SearchField from "./SearchField.svelte"

type Hit = { key: string; name: string; kind: string }

type Props = {
  /** Series drawn now, in URL order; their keys live in the URL as `?s=entity:<key>` or `?s=theme:<id>`. */
  chosen: { key: string; name: string; stream: Stream }[]
  max: number
  /** Name search returning series keys; an empty string finds nothing. */
  search: (q: string) => PromiseLike<Hit[]>
}

let { chosen, max, search }: Props = $props()

/** Typed text without JS: the form submits it as `sq` and the server renders the hits. */
const TYPED = "sq"

const keys = $derived(chosen.map((c) => c.key))
/** The current URL with these picks and no typed text, so every chip and hit is a plain link. */
const withKeys = (next: string[]) => {
  const params = new URLSearchParams(page.url.search)
  params.delete(TYPED)
  params.delete("s")
  for (const k of next) params.append("s", k)
  return `?${params}`
}
const kept = $derived([...page.url.searchParams].filter(([k]) => k !== TYPED))

let term = $state(page.url.searchParams.get(TYPED)?.trim() ?? "")
let timer: ReturnType<typeof setTimeout> | undefined
const typed = (e: Event) => {
  const value = (e.target as HTMLInputElement).value.trim()
  clearTimeout(timer)
  timer = setTimeout(() => (term = value), DASHBOARD.searchDebounceMs)
}
const chip =
  "inline-flex h-(--size-control-sm) items-center gap-2 rounded-full border border-line bg-surface pr-2 pl-3 text-[13px]/5 font-semibold text-ink outline-none transition hover:border-line-control focus-visible:shadow-focus-ring"
</script>

<div class="grid gap-3">
  {#if chosen.length}
    <ul class="flex flex-wrap gap-2">
      {#each chosen as c (c.key)}
        <li>
          <a href={withKeys(keys.filter((k) => k !== c.key))} data-sveltekit-noscroll class={chip}>
            <span class="size-2.5 rounded-full" style:background={streamVar(c.stream)}></span>
            {c.name}
            <X size={14} strokeWidth={2} aria-hidden="true" />
            <span class="dd-sr-only">Remove from the chart</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if chosen.length < max}
    <form method="get" role="search" data-sveltekit-noscroll data-sveltekit-keepfocus oninput={typed} class="sm:w-80">
      {#each kept as [name, value], i (i)}
        <input type="hidden" {name} {value} />
      {/each}
      <SearchField
        name={TYPED}
        placeholder="Add an entity or signal to the chart"
        label="Search entities and signals to chart"
        value={term}
      />
    </form>
    {#if term}
      <svelte:boundary>
        {@const hits = (await search(term)).filter((h) => !keys.includes(h.key))}
        <ul class="flex flex-wrap gap-2">
          {#each hits as h (h.key)}
            <li>
              <a
                href={withKeys([...keys, h.key])}
                data-sveltekit-noscroll
                data-sveltekit-keepfocus
                onclick={() => (term = "")}
                class={chip}
              >
                {h.name}
                <span class="dd-tick font-normal">{h.kind}</span>
              </a>
            </li>
          {:else}
            <li class="dd-body-sm text-ink-muted">No entities or signals match.</li>
          {/each}
        </ul>
        {#snippet pending()}{/snippet}
        {#snippet failed()}
          <p class="dd-body-sm text-ink-muted">Search failed.</p>
        {/snippet}
      </svelte:boundary>
    {/if}
  {:else}
    <p class="dd-body-sm text-ink-muted">The chart draws up to {max} series. Remove one to add another.</p>
  {/if}
</div>
