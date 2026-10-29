<script lang="ts">
import { scaleLinear } from "d3-scale"
import { linePath, type Stream, streamVar } from "./scale.ts"

type Props = {
  values: number[]
  stream?: Stream
  width?: number
  height?: number
  /** Accessible name; say the direction, such as "Security stories, surging". */
  label: string
}

let { values, stream = 1, width = 120, height = 32, label }: Props = $props()

const pad = 5
const last = $derived(values.length - 1)
const lo = $derived(Math.min(...values))
const hi = $derived(Math.max(...values))
const x = $derived(
  scaleLinear()
    .domain([0, Math.max(1, last)])
    .range([pad, width - pad]),
)
const y = $derived(
  scaleLinear()
    .domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi])
    .range([height - pad, pad]),
)
const d = $derived(linePath(values, x, y))
const colour = $derived(streamVar(stream))
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label} class="block overflow-visible">
  {#if last > 0}
    <path d="{d}L{x(last)},{height}L{x(0)},{height}Z" fill-opacity="0.12" style:fill={colour} />
    <path {d} fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style:stroke={colour} />
    <circle cx={x(last)} cy={y(values[last] ?? 0)} r="3.5" stroke-width="2" class="stroke-surface" style:fill={colour} />
  {/if}
</svg>
