<script lang="ts">
import type { Snippet } from "svelte"
import Wordmark from "./Wordmark.svelte"

type Props = {
  nav: { href: string; label: string }[]
  /** The current pathname; an item is current on its own path and below it. */
  current: string
  /** Usually one or two StatusLamps. */
  lamps: Snippet
  /** Usually a SearchField. */
  search: Snippet
}

let { nav, current, lamps, search }: Props = $props()

const isCurrent = (href: string) => current === href || (href !== "/" && current.startsWith(`${href}/`))
</script>

<!-- Phone: wordmark and lamps, then search, then nav. Wide: one 72px row. -->
<header class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-8 lg:h-18 lg:flex-nowrap lg:py-0">
  <Wordmark />
  <nav
    aria-label="Main"
    class="order-3 flex w-full gap-0.5 overflow-x-auto p-1 lg:order-0 lg:ml-6 lg:w-auto lg:overflow-visible lg:p-0"
  >
    {#each nav as item (item.href)}
      <a
        href={item.href}
        aria-current={isCurrent(item.href) ? "page" : undefined}
        class="inline-flex h-9 flex-none items-center rounded-full px-3.5 text-sm/5 font-medium text-ink-muted outline-none hover:bg-surface-sunken hover:text-ink focus-visible:shadow-focus-ring aria-[current=page]:bg-ink aria-[current=page]:text-paper"
      >
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="order-2 w-full lg:order-0 lg:ml-auto lg:w-80">{@render search()}</div>
  <div class="order-1 ml-auto flex items-center gap-4 lg:order-0 lg:ml-0">{@render lamps()}</div>
</header>
