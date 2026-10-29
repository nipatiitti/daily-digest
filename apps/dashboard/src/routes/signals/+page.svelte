<script lang="ts">
import { Sparkline } from "#lib/charts/index.ts"
import { Delta, fmtInt, fmtTime, padId, SegmentedControl, STREAM_NAMES, streamSlot } from "#lib/components/index.ts"
import { page } from "$app/state"
import { signalList } from "./signals.remote.ts"

const STATUSES = ["active", "provisional", "closed", "all"] as const
const LABELS = { active: "Active", provisional: "Provisional", closed: "Closed", merged: "Merged", all: "All" }

const params = $derived(page.url.searchParams)
const status = $derived(STATUSES.find((s) => s === params.get("status")) ?? "active")
const pageNo = $derived(Math.max(1, Math.floor(Number(params.get("page"))) || 1))
/** The current URL with these params changed. */
const withParams = (set: Record<string, string>) => {
  const next = new URLSearchParams(page.url.search)
  for (const [k, v] of Object.entries(set)) next.set(k, v)
  return `?${next}`
}
const options = $derived(
  STATUSES.map((s) => ({ value: s, label: LABELS[s], href: withParams({ status: s, page: "1" }) })),
)
const HEAD = ["ID", "Name", "Status", "Stories", "Streams", "Momentum", "Articles, last 24 hours", "Last story"]
</script>

<svelte:head>
  <title>Signals</title>
</svelte:head>

<div class="grid gap-8 pt-8">
  <header class="flex flex-wrap items-end justify-between gap-6">
    <h1 class="dd-display">Signals</h1>
    <SegmentedControl label="Status" {options} value={status} />
  </header>

  <svelte:boundary>
    {@const list = await signalList({ status, page: pageNo })}
    {#if list.rows.length}
      <div class="overflow-x-auto">
        <table class="dd-body-sm w-full text-left">
          <thead class="dd-label">
            <tr>
              {#each HEAD as h (h)}
                <th class="py-2 pr-4">{h}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each list.rows as t (t.id)}
              <tr class="border-t border-line align-middle">
                <td class="py-2 pr-4"><a href="/signals/{t.id}" class="dd-tick">{padId("SIG", t.id)}</a></td>
                <td class="pr-4">
                  <a href="/signals/{t.id}" class="font-semibold hover:underline">{t.name}</a>
                  {#if t.explanation}<p class="text-ink-muted">{t.explanation}</p>{/if}
                </td>
                <td class="dd-tick pr-4">{LABELS[t.status]}</td>
                <td class="dd-data pr-4">{fmtInt(t.storyCount)}</td>
                <td class="pr-4 whitespace-nowrap">
                  {#each t.streams as c (c)}
                    <span
                      class="mr-1 inline-block size-2.5 rounded-full"
                      style:background="var(--stream-{streamSlot(c)})"
                      title={STREAM_NAMES[c]}
                    ></span>
                    <span class="dd-sr-only">{STREAM_NAMES[c]}</span>
                  {/each}
                </td>
                <td class="pr-4"><Delta pct={t.momentum} suffix="24h" /></td>
                <td class="pr-4">
                  <Sparkline
                    values={t.spark}
                    stream="other"
                    width={96}
                    height={24}
                    label="{t.name}, articles per hour"
                  />
                </td>
                <td class="dd-tick whitespace-nowrap">{fmtTime(t.lastSeen)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="dd-body text-ink-muted">No signals with this status.</p>
    {/if}
    {#if pageNo > 1 || list.more}
      <nav class="dd-body-sm flex gap-6" aria-label="Pages">
        {#if pageNo > 1}<a href={withParams({ page: String(pageNo - 1) })} class="hover:underline">Newer</a>{/if}
        {#if list.more}<a href={withParams({ page: String(pageNo + 1) })} class="hover:underline">Older</a>{/if}
      </nav>
    {/if}
    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load signals</p>
    {/snippet}
  </svelte:boundary>
</div>
