<script lang="ts">
import { ArrowDownRight, ArrowUpRight, MoveRight } from "@lucide/svelte"
import { fmtInt } from "./format.ts"

type Props = {
  /** Percent change; null when there is no base to compare against. */
  pct: number | null
  recent?: number
  previous?: number
  /** Short context after the number, such as "24h". */
  suffix?: string
}

let { pct, recent, previous, suffix }: Props = $props()

const change = $derived(pct !== null ? Math.round(pct) : Math.sign((recent ?? 0) - (previous ?? 0)))
const trend = $derived(change > 0 ? "up" : change < 0 ? "down" : "flat")
const text = $derived(
  pct !== null
    ? `${change > 0 ? "+" : ""}${fmtInt(change)}%`
    : recent !== undefined && previous !== undefined
      ? `from ${fmtInt(previous)} to ${fmtInt(recent)}`
      : "New",
)
const Icon = $derived(trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : MoveRight)
</script>

<span
  data-trend={trend}
  class={[
    "inline-flex h-6 items-center gap-1 rounded-full pr-2.5 pl-2 font-mono text-xs/4 font-semibold whitespace-nowrap tabular-nums",
    trend === "up" && "bg-amber-soft text-amber-ink",
    trend === "down" && "bg-trend-down-soft text-trend-down",
    trend === "flat" && "bg-surface-sunken text-ink-muted",
  ]}
>
  <Icon size={14} strokeWidth={2} />
  {text}
  {#if suffix}<span class="font-medium">{suffix}</span>{/if}
</span>
