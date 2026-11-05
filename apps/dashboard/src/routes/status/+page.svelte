<script lang="ts">
import { countryName, EDITION_LABEL, parseEditionKey, STATUS } from "@digest/core"
import { BarChart } from "#lib/charts/index.ts"
import Button from "#lib/components/Button.svelte"
import { fmtInt, fmtTime } from "#lib/components/format.ts"
import { sourceForm, status } from "./status.remote.ts"

const table = "dd-body-sm w-full text-left"
const usd = (n: number) => `${n.toFixed(2)} USD`
const pct = (part: number, whole: number) => (whole ? `${fmtInt((part / whole) * 100)}%` : "No events")
/** A duration in minutes up to two hours, in hours up to two days, then in days. */
const age = (ms: number | null) => {
  if (ms === null) return "Never"
  const min = ms / 60_000
  return min < 120 ? `${fmtInt(min)} min` : min < 2880 ? `${fmtInt(min / 60)} h` : `${fmtInt(min / 1440)} days`
}
const counts = (rows: { status: string; n: number }[]) => rows.map((r) => `${fmtInt(r.n)} ${r.status}`).join(", ")
const edition = (key: string) => {
  const p = parseEditionKey(key)
  return p ? `${p.date} ${EDITION_LABEL[p.edition]}` : key
}

/** Submits only after the browser's confirm dialog when the button pressed disables the source. */
const confirmDisable =
  (name: string) => async (f: { fields: { action: { value(): unknown } }; submit: () => Promise<unknown> }) => {
    if (f.fields.action.value() !== "disable" || confirm(`Disable ${name}? It stops polling until enabled.`)) {
      await f.submit()
    }
  }
</script>

<svelte:head>
  <title>Status</title>
</svelte:head>

{#snippet head(cells: string[])}
  <thead class="dd-label">
    <tr>
      {#each cells as h (h)}
        <th class="py-2 pr-4 whitespace-nowrap">{h}</th>
      {/each}
    </tr>
  </thead>
{/snippet}

<div class="grid gap-12 pt-8">
  <h1 class="dd-display">Status</h1>

  <svelte:boundary>
    {@const s = await status()}
    {@const f = s.fresh ?? { day: 0, daySingles: 0, week: 0, weekSingles: 0 }}

    <section class="grid gap-4 md:grid-cols-2">
      <div class="grid content-start gap-2">
        <h2 class="dd-label">Ingest</h2>
        <p class="dd-body">
          {fmtInt(s.ingest.backlog)} articles waiting{#if s.ingest.oldest !== null}, the oldest fetched
            {age(s.now - s.ingest.oldest)} ago{/if}. {fmtInt(s.ingest.lastHour)} placed in events in the last hour.
        </p>
      </div>
      <div class="grid content-start gap-2">
        <h2 class="dd-label">Claude spend</h2>
        <p class="dd-body">
          Today {usd(s.today.pipeline + s.today.dashboard)} of the day's allowance {usd(s.caps.pipeline)}, of which
          the dashboard {usd(s.today.dashboard)} of its {usd(s.caps.dashboard)}. This month {usd(s.month.spent)} of
          {usd(s.month.budget)}.
        </p>
      </div>
    </section>

    <section class="grid gap-4">
      <h2 class="dd-label">Hourly loop</h2>
      <div class="overflow-x-auto">
        <table class={table}>
          {@render head(["Step", "Last", "Age", "Counts"])}
          <tbody>
            {#each s.loop as r (r.name)}
              <tr class={["border-t border-line align-top", { "text-sev-high": r.stale }]}>
                <td class="py-2 pr-4">{r.name}{r.stale ? ", stale" : ""}</td>
                <td class="dd-tick py-2 pr-4 whitespace-nowrap">{r.last === null ? "Never" : fmtTime(r.last, s.now)}</td>
                <td class="dd-data py-2 pr-4 whitespace-nowrap">{age(r.age)}</td>
                <td class="py-2 text-ink-muted">{r.detail.map(([k, n]) => `${k} ${fmtInt(n)}`).join(", ")}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid gap-4">
      <h2 class="dd-label">Claude spend per UTC day</h2>
      <div class="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <BarChart
          title="Spend per day by purpose"
          orientation="vertical"
          items={s.spend}
          unit=" USD"
          caps={[
            { label: `Today's allowance ${usd(s.caps.pipeline)}`, value: s.caps.pipeline },
            { label: `Dashboard cap ${usd(s.caps.dashboard)}`, value: s.caps.dashboard },
          ]}
        />
      </div>
    </section>

    <section class="grid gap-4">
      <h2 class="dd-label">Clustering</h2>
      <p class="dd-body max-w-prose">
        Events with one article: {pct(f.daySingles, f.day)} of {fmtInt(f.day)} first seen in the last 24 hours,
        {pct(f.weekSingles, f.week)} of {fmtInt(f.week)} in the last 7 days. Events
        {counts(s.counts.events)}. Threads {counts(s.counts.threads)}.
      </p>
      <div class="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <BarChart title="Same-event decisions per hour" orientation="vertical" items={s.pairs} />
      </div>
      <div class="overflow-x-auto">
        <table class="{table} max-w-prose">
          <caption class="dd-label pb-2 text-left">Placements by how, last {STATUS.clusterHours} hours</caption>
          {@render head(["How", "Articles"])}
          <tbody>
            {#each s.hows as r (r.how)}
              <tr class="border-t border-line">
                <td class="py-2 pr-4">{r.how}</td>
                <td class="dd-data">{fmtInt(r.n)}</td>
              </tr>
            {:else}
              <tr><td colspan="2" class="py-2 text-ink-muted">No placements.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid gap-4">
      <h2 class="dd-label">Last editions</h2>
      <div class="overflow-x-auto">
        <table class={table}>
          {@render head(["Edition", "Status", "Sent", "Items", "Shadow"])}
          <tbody>
            {#each s.editions as e (e.key)}
              <tr class="border-t border-line">
                <td class="py-2 pr-4"><a href="/digest/{e.key}" class="hover:underline">{edition(e.key)}</a></td>
                <td class="dd-tick pr-4">{e.status}</td>
                <td class="dd-tick pr-4 whitespace-nowrap">{e.sentAt === null ? "Not sent" : fmtTime(e.sentAt, s.now)}</td>
                <td class="dd-data pr-4">{e.items === null ? "" : fmtInt(e.items)}</td>
                <td class="text-ink-muted">{e.modes?.split(",").join(", ") ?? "None"}</td>
              </tr>
            {:else}
              <tr><td colspan="5" class="py-2 text-ink-muted">No editions yet.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid gap-4">
      <h2 class="dd-label">Sources</h2>
      <div class="overflow-x-auto">
        <table class={table}>
          {@render head(["Name", "Role", "Country", "Last status", "Failures", "Items, 24h", "Newest item", ""])}
          <tbody>
            {#each s.sources as src (src.id)}
              {@const sf = sourceForm.for(src.id)}
              <tr class={["border-t border-line align-middle", { "opacity-60": !src.enabled }]}>
                <td class="py-2 pr-4 font-semibold">{src.name}{src.enabled ? "" : ", disabled"}</td>
                <td class="dd-tick pr-4">{src.role}</td>
                <td class="pr-4">{src.country ? countryName(src.country) : "International"}</td>
                <td class="dd-data pr-4">{src.lastStatus === 0 ? "Error" : (src.lastStatus ?? "")}</td>
                <td class={["dd-data pr-4", { "text-sev-high": src.consecutiveFailures > 0 }]}>
                  {fmtInt(src.consecutiveFailures)}
                </td>
                <td class="dd-data pr-4">{fmtInt(src.items24h)}</td>
                <td class="dd-data pr-4 whitespace-nowrap">
                  {age(src.lastNewItemAt === null ? null : s.now - src.lastNewItemAt)}
                </td>
                <td class="py-2">
                  <form {...sf.enhance(confirmDisable(src.name))} class="flex items-center gap-1">
                    <input {...sf.fields.id.as("hidden", src.id)} />
                    <Button size="sm" variant="ghost" {...sf.fields.action.as("submit", src.enabled ? "disable" : "enable")}>
                      {src.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!src.enabled} {...sf.fields.action.as("submit", "poll")}>
                      Poll now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={src.consecutiveFailures === 0}
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
    </section>

    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load the status</p>
    {/snippet}
  </svelte:boundary>
</div>
