<script module lang="ts">
import { fmtValue, type Stream, streamVar } from "./scale.ts"

type Key = { name: string; stream: Stream }
type Scale = (v: number) => number
type Tick = { x: number; text?: string }
type Row = { label: string; href?: string; cells: string[] }

// Shared with BarChart so both charts draw the same legend, gridlines, ruler and table.
export { grid, legend, ruler, table }
</script>

<script lang="ts">
import { scaleLinear } from "d3-scale"
import { fmtTick, linePath, niceTicks, thinLabels } from "./scale.ts"

type Props = {
  /** ISO timestamps, oldest first, one per value. */
  labels: string[]
  /** Up to eight. Colour comes from `stream`, never from order. */
  series: { name: string; stream: Stream; values: number[] }[]
  /** Index of the last measured point; later points are drawn as projection. */
  projectFrom?: number
  height?: number
  /** Appended to values as is, such as "%" or " USD". */
  unit?: string
  /** Accessible name and table caption. */
  title: string
  onPointClick?: (index: number) => void
  /** Makes every point a link, which works without JS; preferred over `onPointClick`. */
  href?: (index: number) => string
}

let { labels, series, projectFrom, height = 340, unit = "", title, onPointClick, href }: Props = $props()

let width = $state(1120)
let hover = $state<number | null>(null)

const phone = $derived(width < 640)
const h = $derived(phone ? height + 120 : height)
const n = $derived(labels.length)
const labelled = $derived(series.length <= 4)
const m = $derived({ t: 32, r: labelled ? 104 : 24, b: 34, l: 44 })
const base = $derived(h - m.b)
const right = $derived(width - m.r)
const cut = $derived(projectFrom ?? n - 1)
const projecting = $derived(cut < n - 1)
const range = $derived(Date.parse(labels.at(-1) ?? "") - Date.parse(labels[0] ?? ""))

const ticks = $derived(niceTicks(Math.max(0, ...series.flatMap((s) => s.values))))
const x = $derived(
  scaleLinear()
    .domain([0, Math.max(1, n - 1)])
    .range([m.l, right]),
)
const y = $derived(
  scaleLinear()
    .domain([0, ticks.at(-1) ?? 1])
    .range([base, m.t]),
)

const majors = $derived(new Set(thinLabels(labels, phone ? 4 : Math.floor((right - m.l) / 72))))
const rulerTicks = $derived(labels.map((l, i) => ({ x: x(i), text: majors.has(i) ? fmtTick(l, range) : undefined })))

/** Direct end labels, sorted top to bottom and pushed apart so they never overlap. */
const ends = $derived.by(() => {
  const out = series
    .map((s) => ({ name: s.name, v: s.values.at(-1) ?? 0, y: y(s.values.at(-1) ?? 0) }))
    .sort((a, b) => a.y - b.y)
  let prev = Number.NEGATIVE_INFINITY
  for (const e of out) {
    e.y = Math.max(e.y, prev + 30)
    prev = e.y
  }
  return out
})

const flip = $derived(hover !== null && x(hover) + 240 > width)

const track = (e: PointerEvent & { currentTarget: SVGSVGElement }) => {
  const box = e.currentTarget.getBoundingClientRect()
  const i = Math.round(x.invert(((e.clientX - box.left) * width) / box.width))
  hover = n ? Math.max(0, Math.min(n - 1, i)) : null
}

const stamp = (i: number) => `${fmtTick(labels[i] ?? "", range, true)}${projecting && i > cut ? " (projected)" : ""}`
</script>

{#snippet legend(keys: Key[])}
  <ul class="flex flex-wrap gap-x-5 gap-y-2">
    {#each keys as key (key.name)}
      <li class="dd-body-sm inline-flex items-center gap-2 text-ink-muted">
        <span class="h-1 w-3.5 rounded-full" style:background={streamVar(key.stream)}></span>
        {key.name}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet grid(values: number[], toY: Scale, x1: number, x2: number)}
  {#each values as v (v)}
    {#if v > 0}<line {x1} {x2} y1={toY(v)} y2={toY(v)} class="stroke-chart-grid" shape-rendering="crispEdges" />{/if}
    <text x={x1 - 10} y={toY(v) + 4} text-anchor="end" class="dd-tick fill-current">{fmtValue(v)}</text>
  {/each}
{/snippet}

<!-- The x axis as a tick ruler: a short tick per point, a long labelled tick on the thinned labels. -->
{#snippet ruler(marks: Tick[], x1: number, x2: number, y0: number)}
  <line {x1} {x2} y1={y0} y2={y0} class="stroke-chart-axis" shape-rendering="crispEdges" />
  {#each marks as mark, i (i)}
    <line
      x1={mark.x}
      x2={mark.x}
      y1={y0}
      y2={y0 + (mark.text ? 8 : 4)}
      class={mark.text ? "stroke-line-control" : "stroke-chart-axis"}
    />
    {#if mark.text}
      <text x={mark.x} y={y0 + 22} text-anchor="middle" class="dd-tick fill-current">{mark.text}</text>
    {/if}
  {/each}
{/snippet}

{#snippet table(caption: string, head: string[], rows: Row[])}
  <table class="dd-sr-only">
    <caption>{caption}</caption>
    <thead>
      <tr>
        {#each head as cell, i (i)}<th scope="col">{cell}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, i (i)}
        <tr>
          <th scope="row">{#if row.href}<a href={row.href}>{row.label}</a>{:else}{row.label}{/if}</th>
          {#each row.cells as cell, j (j)}<td>{cell}</td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<div class="relative grid gap-4" bind:clientWidth={width}>
  <!-- Hover is a pointer nicety; the hidden table carries every point, as links when `href` is given. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
  <svg
    width="100%"
    viewBox="0 0 {width} {h}"
    class={["block overflow-visible", (href || onPointClick) && "cursor-pointer"]}
    role="img"
    aria-label={title}
    onpointermove={track}
    onpointerdown={track}
    onpointerleave={() => (hover = null)}
    onclick={() => hover !== null && onPointClick?.(hover)}
  >
    {#if projecting}
      <rect x={x(cut)} y={m.t - 8} width={right - x(cut) + 8} height={base - m.t + 8} rx="14" class="fill-amber-soft" />
      <text x={right + 2} y={m.t + 8} text-anchor="end" class="dd-label fill-current">PROJECTED</text>
    {/if}

    {@render grid(ticks, y, m.l, right)}
    {@render ruler(rulerTicks, m.l, right, base)}

    {#each series as s (s.name)}
      <g fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style:stroke={streamVar(s.stream)}>
        <path d={linePath(s.values.slice(0, cut + 1), x, y)} />
        {#if projecting}<path d={linePath(s.values.slice(cut), (i) => x(i + cut), y)} stroke-dasharray="2 5" />{/if}
      </g>
    {/each}

    {#if projectFrom !== undefined}
      <line x1={x(cut)} x2={x(cut)} y1={m.t - 2} y2={base} stroke-width="2" stroke-linecap="round" class="stroke-amber" />
      <rect x={x(cut) - 20} y={m.t - 20} width="40" height="18" rx="9" class="fill-amber" />
      <text x={x(cut)} y={m.t - 7} text-anchor="middle" class="dd-label fill-ink">NOW</text>
    {/if}

    {#each series as s (s.name)}
      {@const last = s.values.length - 1}
      <circle
        cx={x(last)}
        cy={y(s.values[last] ?? 0)}
        r="4"
        stroke-width="2"
        class="stroke-surface"
        style:fill={streamVar(s.stream)}
      />
    {/each}

    {#if labelled}
      {#each ends as end (end.name)}
        <text x={right + 14} y={end.y - 2} class="fill-ink-muted text-xs font-semibold">{end.name}</text>
        <text x={right + 14} y={end.y + 13} class="dd-tick fill-ink">{fmtValue(end.v, unit)}</text>
      {/each}
    {/if}

    {#if href}
      {@const step = n > 1 ? x(1) - x(0) : right - m.l}
      {#each labels as _, i (i)}
        <a href={href(i)} tabindex="-1" aria-label={stamp(i)}>
          <rect x={x(i) - step / 2} y="0" width={step} height={h} fill="transparent" />
        </a>
      {/each}
    {/if}

    {#if hover !== null}
      <g class="pointer-events-none">
        <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={base} class="stroke-ink-subtle" />
        {#each series as s (s.name)}
          <circle
            cx={x(hover)}
            cy={y(s.values[hover] ?? 0)}
            r="4.5"
            stroke-width="2"
            class="stroke-surface"
            style:fill={streamVar(s.stream)}
          />
        {/each}
      </g>
    {/if}
  </svg>

  {#if hover !== null}
    {@const i = hover}
    <div
      class={[
        "pointer-events-none absolute z-10 min-w-40 rounded-sm border border-line bg-surface px-3 py-2.5 shadow-lg",
        flip && "-translate-x-full",
      ]}
      style:left="{x(i) + (flip ? -16 : 16)}px"
      style:top="{m.t}px"
    >
      <p class="dd-label mb-1">{stamp(i)}</p>
      {#each series.toSorted((a, b) => (b.values[i] ?? 0) - (a.values[i] ?? 0)) as s (s.name)}
        <p class="dd-body-sm flex items-center gap-2 text-ink">
          <span class="size-2.5 rounded-full" style:background={streamVar(s.stream)}></span>
          {s.name}
          <b class="dd-data ml-auto pl-4">{fmtValue(s.values[i] ?? 0, unit)}</b>
        </p>
      {/each}
    </div>
  {/if}

  {#if series.length > 1}{@render legend(series)}{/if}

  {@render table(
    title,
    ["Time", ...series.map((s) => s.name)],
    labels.map((_, i) => ({
      label: stamp(i),
      href: href?.(i),
      cells: series.map((s) => fmtValue(s.values[i] ?? 0, unit)),
    })),
  )}
</div>
