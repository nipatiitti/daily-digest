<script lang="ts">
import { Search } from "@lucide/svelte"

type Props = {
  name: string
  placeholder: string
  value?: string
  /** When given, the field is wrapped in a GET form that submits to this URL. */
  action?: string
  /** The accessible name; the placeholder is not a label. */
  label?: string
}

let { name, placeholder, value, action, label = "Search stories, signals and facts" }: Props = $props()
</script>

{#snippet field()}
  <label
    class="flex h-(--size-control-lg) w-full min-w-0 items-center gap-2.5 rounded-full border border-line-control bg-surface pr-2 pl-5 text-ink-subtle focus-within:border-focus focus-within:shadow-focus-ring"
  >
    <Search size={16} strokeWidth={1.75} class="flex-none" />
    <span class="dd-sr-only">{label}</span>
    <input
      type="search"
      {name}
      {placeholder}
      {value}
      class="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-subtle"
    />
  </label>
{/snippet}

{#if action}
  <form method="get" {action} role="search">{@render field()}</form>
{:else}
  {@render field()}
{/if}
