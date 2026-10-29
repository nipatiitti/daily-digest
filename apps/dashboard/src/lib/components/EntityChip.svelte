<script module lang="ts">
/** The entity page for a normalised key. */
export const entityHref = (key: string) => `/entities/${encodeURIComponent(key)}`
</script>

<script lang="ts">
import Delta from "./Delta.svelte"

type Props = {
  entityKey: string
  name: string
  /** One word, such as org, product or cve. */
  kind: string
  /** 24 hour momentum; null for a rise from 0. */
  pct: number | null
}

let { entityKey, name, kind, pct }: Props = $props()
</script>

<a
  href={entityHref(entityKey)}
  class="inline-flex h-(--size-control-md) items-center gap-2.5 rounded-full border border-line bg-surface pr-2 pl-4 text-ink shadow-xs outline-none transition hover:border-line-control hover:shadow-sm focus-visible:shadow-focus-ring"
>
  <span class="text-sm/5 font-semibold whitespace-nowrap">{name}</span>
  <span class="dd-tick">{kind}</span>
  <Delta {pct} suffix="24h" />
</a>
