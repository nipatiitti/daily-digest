<script lang="ts">
import { scaleBand, scaleLinear } from "d3-scale"
import { fmtValue, niceTicks, type Stream, streamVar, thinLabels } from "./scale.ts"
import { grid, legend, ruler, table } from "./TrendChart.svelte"

type Value = { name: string; value: number; stream?: Stream }

type Props = {
  /** One bar per item; several values stack in order. */
  items: { label: string; values: Value[] }[]
  orientation?: "horizontal" | "vertical"
  /** Top of the scale; defaults to a nice number above the largest total and cap. */
  max?: number
  /** Appended to values as is, such as "%" or " USD". */
  unit?: string
  /** Accessible name and table caption. */
  title: string
  /** Limits drawn as labelled dashed lines, such as the spend caps. */
  caps?: { label: string; value: number }[]
  /** Height of a vertical chart; a horizontal one grows with its rows. */
  height?: number
}

let { items, orientation = "horizontal", max, unit = "", title, caps = [], height = 240 }: Props = $props()

let width = $state(1120)

const ROW = 44
const totals = $derived(items.map((it) => it.values.reduce((sum, v) => sum + v.value, 0)))
const ticks = $derived(niceTicks(max ?? Math.max(0, ...totals, ...caps.map((c) => c.value))))
const top = $derived(max ?? ticks.at(-1) ?? 1)
const keys = $derived([
  ...new Map(
    items.flatMap((it) => it.values.map((v) => [v.name, { name: v.name, stream: v.stream ?? 1 }] as const)),
  ).values(),
])
const stacked = $derived(keys.length > 1)

const capPad = $derived(caps.length ? 20 : 0)
const h = $derived(orientation === "horizontal" ? capPad + items.length * ROW : height)
const m = { t: 16, r: 16, b: 34, l: 44 }
const base = $derived(h - m.b)
const right = $derived(width - m.r)
const xs = $derived(scaleLinear().domain([0, top]).range([0, width]))
const ys = $derived(scaleLinear().domain([0, top]).range([base, m.t]))
const band = $derived(
  scaleBand<number>()
    .domain(items.map((_, i) => i))
    .range([m.l, right])
    .paddingInner(0.3)
    .paddingOuter(0.15),
)
const bw = $derived(band.bandwidth())
const majors = $derived(new Set(thinLabels(items, width < 640 ? 4 : Math.floor((right - m.l) / 56))))

/** Each value as a bar from zero to its running total, painted last to first so the stack reads in order. */
const stack = (values: Value[]) => {
  let to = 0
  const bars = values.map((v) => {
    to += v.value
    return { ...v, to }
  })
  return bars.reverse()
}
</script>

<div class="relative grid gap-4" bind:clientWidth={width}>
  <svg width="100%" viewBox="0 0 {width} {h}" class="block overflow-visible" role="img" aria-label={title}>
    {#if orientation === "horizontal"}
      {#each items as item, i (i)}
        {@const y0 = capPad + i * ROW}
        <text y={y0 + 14} class="dd-body-sm fill-ink-muted">{item.label}</text>
        <text x={width} y={y0 + 14} text-anchor="end" class="dd-data fill-ink">{fmtValue(totals[i] ?? 0, unit)}</text>
        <rect y={y0 + 22} {width} height="10" rx="5" class="fill-surface-sunken" />
        {#each stack(item.values) as bar (bar.name)}
          <rect y={y0 + 22} width={xs(bar.to)} height="10" rx="5" style:fill={streamVar(bar.stream ?? 1)}>
            <title>{bar.name} {fmtValue(bar.value, unit)}</title>
          </rect>
        {/each}
      {/each}
      {#each caps as cap (cap.label)}
        <line x1={xs(cap.value)} x2={xs(cap.value)} y1={capPad - 4} y2={h} stroke-dasharray="4 4" class="stroke-ink-subtle" />
        <text x={xs(cap.value) - 4} y="12" text-anchor="end" class="dd-label fill-current">{cap.label}</text>
      {/each}
    {:else}
      {@render grid(
        ticks.filter((t) => t <= top),
        ys,
        m.l,
        right,
      )}
      {@render ruler(
        items.map((it, i) => ({ x: (band(i) ?? 0) + bw / 2, text: majors.has(i) ? it.label : undefined })),
        m.l,
        right,
        base,
      )}
      {#each items as item, i (i)}
        {#each stack(item.values) as bar (bar.name)}
          <rect
            x={band(i)}
            y={ys(bar.to)}
            width={bw}
            height={base - ys(bar.to)}
            rx={Math.min(6, bw / 2)}
            style:fill={streamVar(bar.stream ?? 1)}
          >
            <title>{item.label} {bar.name} {fmtValue(bar.value, unit)}</title>
          </rect>
        {/each}
      {/each}
      {#each caps as cap (cap.label)}
        <line x1={m.l} x2={right} y1={ys(cap.value)} y2={ys(cap.value)} stroke-dasharray="4 4" class="stroke-ink-subtle" />
        <text x={right} y={ys(cap.value) - 6} text-anchor="end" class="dd-label fill-current">{cap.label}</text>
      {/each}
    {/if}
  </svg>

  {#if stacked}{@render legend(keys)}{/if}

  {@render table(
    title,
    ["Item", ...keys.map((k) => k.name), ...(stacked ? ["Total"] : [])],
    items.map((it, i) => ({
      label: it.label,
      cells: [
        ...keys.map((k) => fmtValue(it.values.find((v) => v.name === k.name)?.value ?? 0, unit)),
        ...(stacked ? [fmtValue(totals[i] ?? 0, unit)] : []),
      ],
    })),
  )}
</div>
