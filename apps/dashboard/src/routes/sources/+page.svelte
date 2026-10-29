<script lang="ts">
import type { Category } from "@digest/db"
import { Sparkline } from "#lib/charts/index.ts"
import { Button, fmtInt, fmtTime, STREAM_NAMES, StatusLamp, streamSlot } from "#lib/components/index.ts"
import { page } from "$app/state"
import { sourceForm, sourceRows } from "./sources.remote.ts"

const CATEGORIES = Object.keys(STREAM_NAMES) as Category[]
const category = $derived(CATEGORIES.find((c) => c === page.url.searchParams.get("category")))
const input = "h-(--size-control-sm) w-40 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"
const LAMP_LABELS = { live: "Live", stale: "Stale", off: "Off" }
const HEAD = ["Lamp", "Name", "Tier", "Category", "Last status", "Failures", "Next poll", "Items, 24h", "Items per day"]

/** Submits only after the browser's confirm dialog when the button pressed disables the source. */
const confirmDisable =
  (name: string) => async (f: { fields: { action: { value(): unknown } }; submit: () => Promise<unknown> }) => {
    if (f.fields.action.value() !== "disable" || confirm(`Disable ${name}? It stops polling until enabled.`)) {
      await f.submit()
    }
  }
</script>

<svelte:head>
  <title>Sources</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <header class="flex flex-wrap items-end justify-between gap-6">
    <h1 class="dd-display">Sources</h1>
    <form action="/sources" class="flex items-center gap-2">
      <label class="dd-label">
        Category
        <select name="category" class={input}>
          <option value="">All</option>
          {#each CATEGORIES as c (c)}
            <option value={c} selected={category === c}>{STREAM_NAMES[c]}</option>
          {/each}
        </select>
      </label>
      <Button type="submit" size="sm">Filter</Button>
    </form>
  </header>

  <svelte:boundary>
    {@const all = await sourceRows()}
    {@const rows = category ? all.rows.filter((s) => s.category === category) : all.rows}
    {@const lamps = (lamp: string) => rows.filter((s) => s.lamp === lamp).length}
    <p class="dd-body-sm text-ink-muted">
      {fmtInt(rows.length)} sources, {fmtInt(rows.filter((s) => s.enabled).length)} enabled, {fmtInt(lamps("live"))}
      live, {fmtInt(lamps("stale"))} stale, {fmtInt(lamps("off"))} off.
    </p>
    {#if rows.length}
      <div class="overflow-x-auto">
        <table class="dd-body-sm w-full text-left">
          <thead class="dd-label">
            <tr>
              {#each HEAD as h (h)}
                <th class="py-2 pr-4 whitespace-nowrap">{h}</th>
              {/each}
              <th class="py-2"><span class="dd-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each rows as s (s.id)}
              {@const sf = sourceForm.for(s.id)}
              <tr class={["border-t border-line align-middle", { "opacity-60": !s.enabled }]}>
                <td class="py-2 pr-4">
                  <StatusLamp state={s.lamp} label={s.enabled ? LAMP_LABELS[s.lamp] : "Disabled"} />
                </td>
                <td class="pr-4">
                  <a href="/data/sources/{s.id}" class="font-semibold hover:underline">{s.name}</a>
                </td>
                <td class="dd-tick pr-4">{s.tier}</td>
                <td class="dd-tick pr-4">{STREAM_NAMES[s.category]}</td>
                <td class="dd-data pr-4">{s.lastStatus === 0 ? "Error" : (s.lastStatus ?? "")}</td>
                <td class="dd-data pr-4">{fmtInt(s.consecutiveFailures)}</td>
                <td class="dd-tick pr-4 whitespace-nowrap">
                  {!s.enabled ? "Never" : s.nextPollAt <= all.now ? "Due" : fmtTime(s.nextPollAt, all.now)}
                </td>
                <td class="dd-data pr-4">{fmtInt(s.items24h)}</td>
                <td class="pr-4">
                  <Sparkline
                    values={s.spark}
                    stream={streamSlot(s.category)}
                    width={96}
                    height={24}
                    label="{s.name}, items per day"
                  />
                </td>
                <td class="py-2">
                  <form {...sf.enhance(confirmDisable(s.name))} class="flex items-center gap-1">
                    <input {...sf.fields.id.as("hidden", s.id)} />
                    <Button
                      size="sm"
                      variant="ghost"
                      {...sf.fields.action.as("submit", s.enabled ? "disable" : "enable")}
                    >
                      {s.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!s.enabled} {...sf.fields.action.as("submit", "poll")}>
                      Poll now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={s.consecutiveFailures === 0}
                      {...sf.fields.action.as("submit", "reset")}
                    >
                      Reset backoff
                    </Button>
                  </form>
                  {#each sf.fields.allIssues() ?? [] as issue, i (i)}
                    <p class="text-sev-high">{issue.message}</p>
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="dd-body text-ink-muted">No sources in this category.</p>
    {/if}
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load sources</p>
    {/snippet}
  </svelte:boundary>
</div>
