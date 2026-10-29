<script lang="ts">
import { BarChart } from "#lib/charts/index.ts"
import { Button, fmtInt, fmtTime, padId } from "#lib/components/index.ts"
import { page } from "$app/state"
import { calibration, database, evaluations, gates, loop, spend } from "./ops.remote.ts"

type Runs = Awaited<ReturnType<typeof loop>>["steps"]

const params = $derived(page.url.searchParams)
const input = "h-(--size-control-sm) rounded-full border border-line-control bg-surface px-3 text-sm text-ink"
const table = "dd-body-sm w-full text-left"
const SHADOW = [
  { value: "yes", label: "Shadow" },
  { value: "no", label: "Live" },
]

/** This URL with the gate log page starting after `after`, or at the first page when null. */
const gatesHref = (after: number | null) => {
  const p = new URLSearchParams(page.url.search)
  if (after === null) p.delete("after")
  else p.set("after", String(after))
  return `?${p}#gates`
}

const usd = (n: number) => `${n.toFixed(2)} USD`
const pct = (n: number) => `${fmtInt(n * 100)}%`
const age = (ms: number | null) => (ms === null ? "Never" : `${fmtInt(ms / 60_000)} min`)
</script>

<svelte:head>
  <title>Ops</title>
</svelte:head>

{#snippet loading()}
  <p class="dd-label py-6">Loading</p>
{/snippet}

{#snippet failed()}
  <p class="dd-label py-6 text-ink-muted">Could not load this block</p>
{/snippet}

{#snippet gatesFailed()}
  <p class="dd-label py-6 text-ink-muted">
    Could not load the gate log. <a href="/ops#gates" class="underline">Clear the filters</a>
  </p>
{/snippet}

{#snippet head(cells: string[])}
  <thead class="dd-label">
    <tr>
      {#each cells as h (h)}
        <th class="py-2 pr-4 whitespace-nowrap">{h}</th>
      {/each}
    </tr>
  </thead>
{/snippet}

<!-- Hourly steps or rollup kinds with their newest write, stale ones marked. -->
{#snippet runs(caption: string, rows: Runs)}
  <div class="overflow-x-auto">
    <table class={table}>
      <caption class="dd-label pb-2 text-left">{caption}</caption>
      {@render head(["Name", "Last", "Age", "Rows"])}
      <tbody>
        {#each rows as r (r.name)}
          <tr class={["border-t border-line align-top", { "text-sev-high": r.stale }]}>
            <td class="py-2 pr-4">{r.name}{r.stale ? ", stale" : ""}</td>
            <td class="dd-tick py-2 pr-4 whitespace-nowrap">{r.last === null ? "Never" : fmtTime(r.last)}</td>
            <td class="dd-data py-2 pr-4 whitespace-nowrap">{age(r.age)}</td>
            <td class="py-2 text-ink-muted">{r.detail.map(([k, n]) => `${k} ${fmtInt(n)}`).join(", ")}</td>
          </tr>
        {:else}
          <tr><td colspan="4" class="py-2 text-ink-muted">No runs yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<div class="grid gap-12 pt-8">
  <h1 class="dd-display">Ops</h1>

  <section id="spend" class="grid gap-4">
    <h2 class="dd-label">Claude spend per UTC day</h2>
    <svelte:boundary pending={loading} {failed}>
      {@const s = await spend()}
      <div class="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <BarChart
          title="Spend per day by purpose"
          orientation="vertical"
          items={s.items}
          unit=" USD"
          caps={s.caps}
        />
      </div>
      <div class="grid gap-8 md:grid-cols-2">
        <div class="overflow-x-auto">
          <table class={table}>
            <caption class="dd-label pb-2 text-left">Today</caption>
            {@render head(["Purpose", "Calls", "Spend", "Cap", "Share of cap"])}
            <tbody>
              {#each s.today as r (r.purpose)}
                <tr class="border-t border-line">
                  <td class="py-2 pr-4">{r.purpose}</td>
                  <td class="dd-data pr-4">{fmtInt(r.calls)}</td>
                  <td class="dd-data pr-4 whitespace-nowrap">{usd(r.usd)}</td>
                  <td class="dd-tick pr-4">{r.cap}</td>
                  <td class="dd-data">{pct(r.share)}</td>
                </tr>
              {:else}
                <tr><td colspan="5" class="py-2 text-ink-muted">No calls today.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="overflow-x-auto">
          <table class={table}>
            <caption class="dd-label pb-2 text-left">By model, whole chart</caption>
            {@render head(["Purpose", "Model", "Calls", "Spend"])}
            <tbody>
              {#each s.models as r (`${r.purpose}/${r.model}`)}
                <tr class="border-t border-line">
                  <td class="py-2 pr-4">{r.purpose}</td>
                  <td class="dd-tick pr-4">{r.model}</td>
                  <td class="dd-data pr-4">{fmtInt(r.calls)}</td>
                  <td class="dd-data whitespace-nowrap">{usd(r.usd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </svelte:boundary>
  </section>

  <section id="gates" class="grid gap-4">
    <h2 class="dd-label">Gate log</h2>
    <!-- A failed boundary stays failed, so each URL gets a fresh one. -->
    {#key page.url.search}
      <svelte:boundary pending={loading} failed={gatesFailed}>
        {@const g = await gates(page.url.search)}
        <form action="/ops#gates" class="flex flex-wrap items-end gap-3">
          <label class="dd-label grid gap-1">
            Gate
            <select name="gate" class={input}>
              <option value="">Any</option>
              {#each g.gates as v (v)}
                <option value={v} selected={params.get("gate") === v}>{v}</option>
              {/each}
            </select>
          </label>
          <label class="dd-label grid gap-1">
            Decision
            <select name="decision" class={input}>
              <option value="">Any</option>
              {#each g.decisions as v (v)}
                <option value={v} selected={params.get("decision") === v}>{v}</option>
              {/each}
            </select>
          </label>
          <label class="dd-label grid gap-1">
            Mode
            <select name="shadow" class={input}>
              <option value="">Any</option>
              {#each SHADOW as o (o.value)}
                <option value={o.value} selected={params.get("shadow") === o.value}>{o.label}</option>
              {/each}
            </select>
          </label>
          <label class="dd-label grid gap-1">
            Day, UTC
            <input type="date" name="date" value={params.get("date") ?? ""} class={input} />
          </label>
          <Button type="submit" size="sm">Filter</Button>
          <Button href="/ops#gates" size="sm" variant="ghost">Clear</Button>
        </form>
        <div class="overflow-x-auto">
          <table class={table}>
            {@render head(["At", "Story", "Gate", "Decision", "Mode", "Reasons"])}
            <tbody>
              {#each g.rows as r (r.id)}
                <tr class="border-t border-line align-top">
                  <td class="dd-tick py-2 pr-4 whitespace-nowrap">{fmtTime(r.at)}</td>
                  <td class="max-w-80 py-2 pr-4">
                    <a href="/stories/{r.storyId}" class="hover:underline">
                      <span class="font-mono">{padId("STY", r.storyId)}</span>
                      {r.title}
                    </a>
                  </td>
                  <td class="dd-tick py-2 pr-4">{r.gate}</td>
                  <td class={["dd-tick py-2 pr-4", { "text-ink-muted": r.decision === "fail" }]}>{r.decision}</td>
                  <td class="dd-tick py-2 pr-4">{r.shadow ? "Shadow" : "Live"}</td>
                  <td class="py-2 text-ink-muted">{r.reasons.join(", ")}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if !g.rows.length}<p class="dd-body text-ink-muted">No gate decisions match.</p>{/if}
        <nav class="flex flex-wrap gap-3" aria-label="Gate log pages">
          {#if params.has("after")}<Button href={gatesHref(null)} size="sm">First page</Button>{/if}
          {#if g.next}<Button href={gatesHref(g.next)} size="sm">Next</Button>{/if}
        </nav>
      </svelte:boundary>
    {/key}
  </section>

  <section id="evals" class="grid gap-4">
    <h2 class="dd-label">Stories evaluated per UTC day</h2>
    <svelte:boundary pending={loading} {failed}>
      <div class="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <BarChart title="Stories evaluated per day" orientation="vertical" items={await evaluations()} />
      </div>
    </svelte:boundary>
  </section>

  <section id="database" class="grid gap-4">
    <h2 class="dd-label">Database size</h2>
    <svelte:boundary pending={loading} {failed}>
      {@const d = await database()}
      {#if d.day}
        <div class="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <BarChart title="Database size per day" orientation="vertical" items={d.items} unit=" MB" />
        </div>
        <div class="overflow-x-auto">
          <table class={table}>
            <caption class="dd-label pb-2 text-left">Rows on {d.day}</caption>
            {@render head(["Table", "Rows"])}
            <tbody>
              {#each d.tables as [name, rows] (name)}
                <tr class="border-t border-line">
                  <td class="py-2 pr-4"><a href="/data/{name}" class="hover:underline">{name}</a></td>
                  <td class="dd-data">{fmtInt(rows)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="dd-body text-ink-muted">Not measured yet.</p>
      {/if}
    </svelte:boundary>
  </section>

  <section id="calibration" class="grid gap-4">
    <h2 class="dd-label">Votes by score band at send</h2>
    <svelte:boundary pending={loading} {failed}>
      {@const bands = await calibration()}
      <div class="overflow-x-auto">
        <table class={table}>
          {@render head(["Band", "Stories delivered", "Up", "Down", "Up rate"])}
          <tbody>
            {#each bands as b (b.label)}
              <tr class="border-t border-line">
                <td class="py-2 pr-4 whitespace-nowrap">{b.label}</td>
                <td class="dd-data pr-4">{fmtInt(b.stories)}</td>
                <td class="dd-data pr-4">{fmtInt(b.up)}</td>
                <td class="dd-data pr-4">{fmtInt(b.down)}</td>
                <td class="dd-data">{b.rate === null ? "No votes" : pct(b.rate)}</td>
              </tr>
            {:else}
              <tr><td colspan="5" class="py-2 text-ink-muted">No stories delivered yet.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </svelte:boundary>
  </section>

  <section id="loop" class="grid gap-4">
    <h2 class="dd-label">Hourly loop</h2>
    <svelte:boundary pending={loading} {failed}>
      {@const l = await loop()}
      <div class="grid gap-8 md:grid-cols-2">
        {@render runs("Steps", l.steps)}
        {@render runs("Rollups, newest write in the last day", l.rollups)}
      </div>
    </svelte:boundary>
  </section>
</div>
