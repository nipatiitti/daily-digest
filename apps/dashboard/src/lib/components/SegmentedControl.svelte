<script lang="ts">
type Option = { value: string; label: string; href?: string }

type Props = {
  /** Two to five options. With `href` each option is a link, so a range change is a URL navigation. */
  options: Option[]
  value: string
  onchange?: (value: string) => void
  /** Names the group for assistive tech, such as "Time range". */
  label: string
}

let { options, value, onchange, label }: Props = $props()

const base =
  "inline-flex h-(--size-control-sm) cursor-pointer items-center rounded-full px-3.5 font-mono text-xs font-medium tracking-[0.06em] uppercase outline-none transition focus-visible:shadow-focus-ring"
const on = "bg-surface text-ink shadow-[var(--shadow-xs),0_0_0_1px_var(--color-line)]"
const off = "text-ink-subtle hover:text-ink"
</script>

<div role="group" aria-label={label} class="inline-flex gap-0.5 rounded-full border border-line bg-surface-sunken p-1">
  {#each options as option (option.value)}
    {@const selected = option.value === value}
    {#if option.href}
      <a href={option.href} aria-current={selected ? "true" : undefined} class={[base, selected ? on : off]}>
        {option.label}
      </a>
    {:else}
      <button type="button" aria-pressed={selected} class={[base, selected ? on : off]} onclick={() => onchange?.(option.value)}>
        {option.label}
      </button>
    {/if}
  {/each}
</div>
