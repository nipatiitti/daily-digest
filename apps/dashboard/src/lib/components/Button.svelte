<script lang="ts">
import type { Snippet } from "svelte"
import type { HTMLAttributes } from "svelte/elements"

type Props = HTMLAttributes<HTMLElement> & {
  /** primary once per view for the main next action; ghost for low emphasis inside cards and toolbars. */
  variant?: "primary" | "secondary" | "ghost"
  size?: "sm" | "md" | "lg"
  /** Renders a link instead of a button. */
  href?: string
  type?: "button" | "submit" | "reset"
  disabled?: boolean
  /** A verb in sentence case. */
  children: Snippet
}

let {
  variant = "secondary",
  size = "md",
  href,
  type = "button",
  disabled = false,
  children,
  class: extra,
  ...rest
}: Props = $props()

const VARIANTS = {
  primary: "border-amber bg-amber text-on-amber hover:border-amber-deep hover:bg-amber-deep",
  secondary: "border-line-control bg-surface text-ink hover:bg-surface-sunken",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink",
}
const SIZES = {
  sm: "h-(--size-control-sm) px-3.5 text-[13px]/5",
  md: "h-(--size-control-md) px-5 text-sm/5",
  lg: "h-(--size-control-lg) px-6 text-sm/5",
}

const cls = $derived([
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border font-semibold whitespace-nowrap outline-none transition active:translate-y-px focus-visible:shadow-focus-ring",
  "disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-ink-subtle",
  VARIANTS[variant],
  SIZES[size],
  extra,
])
</script>

{#if href && !disabled}
  <a {href} class={cls} {...rest}>{@render children()}</a>
{:else}
  <button {type} {disabled} class={cls} {...rest}>{@render children()}</button>
{/if}
