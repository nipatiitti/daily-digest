<script lang="ts">
import type { Category } from "@digest/db"
import { STREAM_NAMES, streamSlot } from "./streams.ts"

let { stream }: { stream: Category } = $props()

const slot = $derived(streamSlot(stream))
</script>

<span
  data-stream={slot}
  class="inline-flex h-7 items-center gap-2 rounded-full bg-surface-sunken pr-3 pl-2.5 text-[13px]/5 font-medium whitespace-nowrap text-ink"
>
  <span class="size-2 rounded-full" style:background="var(--stream-{slot})" aria-hidden="true"></span>
  {STREAM_NAMES[stream]}
</span>
