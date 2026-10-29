<script lang="ts">
type Props = {
  /** live: fresh. stale: older than expected, say how old in the label. off: offline or paused. alert: a critical signal is active. */
  state: "live" | "stale" | "off" | "alert"
  label: string
}

let { state, label }: Props = $props()

const LAMPS = {
  live: "bg-amber shadow-glow-amber",
  stale: "border-2 border-line-control",
  off: "bg-sev-quiet",
  alert: "bg-sev-critical shadow-[0_0_0_4px_#8a1d1b1f]",
}
</script>

<span
  data-state={state}
  class={["dd-label inline-flex items-center gap-2.5", state === "alert" ? "text-sev-critical" : "text-ink-muted"]}
>
  <span class={["size-2.5 flex-none rounded-full", LAMPS[state], { pulse: state === "live" }]} aria-hidden="true"></span>
  {label}
</span>

<style>
  .pulse {
    animation: pulse 2.6s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      box-shadow: var(--shadow-glow-amber);
    }
    50% {
      box-shadow:
        0 0 0 6px #f2a5161a,
        0 0 18px 4px #f2a5162e;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
</style>
