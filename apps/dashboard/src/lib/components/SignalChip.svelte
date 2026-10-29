<script lang="ts">
import Delta from "./Delta.svelte"
import { padId } from "./format.ts"

type Props = {
  id: number
  /** Two to four words, sentence case. Never truncated. */
  name: string
  pct: number | null
  href: string
}

let { id, name, pct, href }: Props = $props()
</script>

<a
  {href}
  class="inline-flex h-(--size-control-md) items-center gap-2.5 rounded-full border border-line bg-surface pr-2 pl-4 text-ink shadow-xs outline-none transition hover:border-line-control hover:shadow-sm focus-visible:shadow-focus-ring"
>
  <span class="dd-tick">{padId("SIG", id)}</span>
  <span class="text-sm/5 font-semibold whitespace-nowrap">{name}</span>
  <Delta {pct} />
</a>
