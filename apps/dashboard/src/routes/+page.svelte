<script lang="ts">
import { DASHBOARD } from "@digest/core"
import { Sparkline, StoryNetwork, type Stream, TrendChart } from "#lib/charts/index.ts"
import {
  Delta,
  FactRow,
  fmtInt,
  padId,
  Readout,
  SegmentedControl,
  SeriesPicker,
  STREAM_NAMES,
  StoryCard,
  streamSlot,
} from "#lib/components/index.ts"
import { parseRange, RANGES } from "#lib/range.ts"
import { page } from "$app/state"
import { network, opsStrip, readouts, seriesFor, seriesSearch, streamSeries, topStories } from "./brief.remote.ts"
import { signalBoard } from "./signals/signals.remote.ts"

type Top = Awaited<ReturnType<typeof topStories>>

const params = $derived(page.url.searchParams)
const range = $derived(parseRange(params.get("range")))
/** Series picked for the big chart, from `?s=entity:<key>` and `?s=theme:<id>`. */
const picks = $derived(
  [...new Set(params.getAll("s").filter((s) => /^(entity|theme):./.test(s)))].slice(0, DASHBOARD.seriesPickerMax),
)
/** A pick's kind and key. */
const pickSeries = (s: string) => {
  const i = s.indexOf(":")
  return { kind: s.slice(0, i) as "entity" | "theme", key: s.slice(i + 1) }
}
/** Picked series take colour slots 5 to 8, after the four streams. */
const slot = (i: number) => (5 + i) as Stream
type Line = { name: string; stream: Stream; values: number[] }
/** The streams, then each known pick in its slot; the chart keys lines by name, so a repeated name gets the key. */
const withPicks = (lines: Line[], picked: ({ key: string; name: string; values: number[] } | null)[]) => {
  const all = [...lines]
  for (const [i, s] of picked.entries()) {
    if (!s) continue
    const name = all.some((l) => l.name === s.name) ? `${s.name} (${s.key})` : s.name
    all.push({ name, stream: slot(i), values: s.values })
  }
  return all
}
const ranges = $derived(
  RANGES.map((r) => {
    const next = new URLSearchParams(page.url.search)
    next.set("range", r)
    return { value: r, label: r === "all" ? "All" : r, href: `?${next}` }
  }),
)
const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date())
</script>

{#snippet loading()}
  <p class="dd-label py-6">Loading</p>
{/snippet}

{#snippet failed()}
  <p class="dd-label py-6 text-ink-muted">Could not load this block</p>
{/snippet}

{#snippet card(s: Top["stories"][number], lead: boolean, rows: Top["facts"])}
  {#snippet factList()}
    <ol class="divide-y divide-line">
      {#each rows as fact (fact.id)}
        <FactRow status={fact.status} text={fact.text} sources={fact.sources} />
      {/each}
    </ol>
  {/snippet}
  <StoryCard
    id={s.id}
    stream={s.category}
    score={s.score}
    updatedAt={s.lastArticleAt}
    title={s.title}
    summary={s.summary ?? "Not evaluated yet."}
    stats={[
      { name: "Articles", value: s.articles },
      { name: "Sources", value: s.sources },
      { name: "Origins", value: s.origins },
    ]}
    {lead}
    themes={s.themes}
    facts={rows.length ? factList : undefined}
  >
    {#snippet momentum()}
      <Delta pct={s.momentum24h} suffix="24h" />
      <Sparkline
        values={s.spark}
        stream={streamSlot(s.category)}
        width={64}
        height={24}
        label="Articles per hour, last 24 hours"
      />
    {/snippet}
  </StoryCard>
{/snippet}

<div class="grid gap-10 pt-8">
  <header class="flex flex-wrap items-end justify-between gap-6">
    <div class="grid gap-2">
      <h1 class="dd-display">{today}</h1>
      <p class="text-ink-muted">The hourly brief appears here once the loop has run.</p>
    </div>
    <SegmentedControl label="Time range" options={ranges} value={range} />
  </header>

  <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
    <svelte:boundary pending={loading} {failed}>
      {#each await readouts(range) as r (r.label)}
        <Readout label={r.label} value={r.value} href={r.href}>
          {#snippet foot()}
            {#if r.delta}<Delta {...r.delta} />{/if}
            <span>{r.note}</span>
            <span class="ml-auto"><Sparkline values={r.spark} stream="other" label="{r.label}, {r.note}" /></span>
          {/snippet}
        </Readout>
      {/each}
    </svelte:boundary>
    <svelte:boundary pending={loading} {failed}>
      {@const board = await signalBoard(range)}
      <Readout label="Signals rising" value={board.rising.value} href="/signals">
        {#snippet foot()}
          {#if board.rising.delta}<Delta {...board.rising.delta} />{/if}
          <span>{board.rising.note}</span>
        {/snippet}
      </Readout>
    </svelte:boundary>
  </section>

  <section class="grid gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <svelte:boundary pending={loading} {failed}>
      {@const [chart, picked] = await Promise.all([
        streamSeries(range),
        Promise.all(picks.map((s) => seriesFor({ ...pickSeries(s), range }))),
      ])}
      {@const title = `Articles per ${chart.bucket} by stream`}
      <h2 class="dd-label">{title}</h2>
      <TrendChart
        labels={chart.labels}
        series={withPicks(chart.series, picked)}
        projectFrom={chart.projectFrom}
        height={DASHBOARD.chartHeight}
        {title}
        href={(i) => chart.hrefs[i] ?? "/stories"}
      />
      <SeriesPicker
        chosen={picks.map((key, i) => ({ key, name: picked[i]?.name ?? key, stream: slot(i) }))}
        max={DASHBOARD.seriesPickerMax}
        search={seriesSearch}
      />
    </svelte:boundary>
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label"><a href="/signals" class="hover:text-ink">Signals</a></h2>
    <svelte:boundary pending={loading} {failed}>
      {@const board = await signalBoard(range)}
      {#if board.cards.length}
        <ol class="grid gap-4 md:grid-cols-2">
          {#each board.cards as t (t.id)}
            <li class="grid content-start gap-2 rounded-lg border border-line bg-surface p-5 shadow-sm">
              <div class="flex flex-wrap items-center gap-2">
                <a href="/signals/{t.id}" class="dd-tick">{padId("SIG", t.id)}</a>
                <Delta pct={t.momentum} suffix={board.suffix} />
                <ul class="flex gap-1" aria-label="Streams">
                  {#each t.streams as c (c)}
                    <li
                      class="size-2.5 rounded-full"
                      style:background="var(--stream-{streamSlot(c)})"
                      title={STREAM_NAMES[c]}
                    >
                      <span class="dd-sr-only">{STREAM_NAMES[c]}</span>
                    </li>
                  {/each}
                </ul>
                <span class="ml-auto">
                  <Sparkline
                    values={t.spark}
                    stream="other"
                    width={96}
                    height={24}
                    label="{t.name}, articles per hour, last 24 hours"
                  />
                </span>
              </div>
              <h3 class="dd-heading"><a href="/signals/{t.id}" class="hover:underline">{t.name}</a></h3>
              {#if t.explanation}<p class="dd-body text-pretty text-ink-muted">{t.explanation}</p>{/if}
              <p class="dd-body-sm text-ink-muted">{fmtInt(t.storyCount)} {t.storyCount === 1 ? "story" : "stories"}</p>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="dd-body text-ink-muted">No active signals yet.</p>
      {/if}
    </svelte:boundary>
  </section>

  <section class="hidden gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm md:grid">
    <h2 class="dd-label">How stories connect</h2>
    <svelte:boundary pending={loading} {failed}>
      {@const net = await network(range)}
      <StoryNetwork nodes={net.nodes} links={net.links} title="How stories connect" />
    </svelte:boundary>
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label">Top stories</h2>
    <svelte:boundary pending={loading} {failed}>
      {@const top = await topStories(range)}
      {@const [lead, ...rest] = top.stories}
      {#if lead}
        {@render card(lead, true, top.facts)}
        <div class="grid gap-6 md:grid-cols-3">
          {#each rest as s (s.id)}
            {@render card(s, false, [])}
          {/each}
        </div>
      {:else}
        <p class="dd-body text-ink-muted">No active stories in this range.</p>
      {/if}
    </svelte:boundary>
  </section>

  <svelte:boundary pending={loading} {failed}>
    <dl class="flex flex-wrap gap-x-10 gap-y-4 border-t border-line pt-6">
      {#each await opsStrip() as o (o.label)}
        <div class="grid gap-1">
          <dt class="dd-label">{o.label}</dt>
          <dd class="dd-body-sm"><a href={o.href} class="text-ink-muted hover:text-ink">{o.value}</a></dd>
        </div>
      {/each}
    </dl>
  </svelte:boundary>
</div>
