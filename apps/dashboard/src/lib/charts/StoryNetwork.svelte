<script lang="ts">
import { DASHBOARD, nodeRadius } from "@digest/core"
import { entityHref } from "../components/EntityChip.svelte"
import { fmtInt } from "../components/format.ts"
import { type Stream, streamVar } from "./scale.ts"

type Node = { id: number; x: number; y: number; weight: number; stream: Stream; title: string }
type Link = { source: number; target: number; weight: number; themeId: number | null; entityKey: string | null }

type Props = {
  /** Placed in the unit box by layoutNetwork; `weight` is the article count. */
  nodes: Node[]
  /** Each joins two of `nodes`, opening the shared signal, else the shared entity. */
  links: Link[]
  /** Accessible name. */
  title: string
}

let { nodes, links, title }: Props = $props()

const { networkWidth: W, networkHeight: H } = DASHBOARD

let hover = $state<number | null>(null)

const byId = $derived(new Map(nodes.map((n) => [n.id, n])))
const max = $derived(Math.max(1, ...nodes.map((n) => n.weight)))
const labelled = $derived(
  new Set(
    nodes
      .toSorted((a, b) => b.weight - a.weight || a.id - b.id)
      .slice(0, DASHBOARD.networkLabels)
      .map((n) => n.id),
  ),
)

const linkHref = (l: Link) => (l.themeId === null ? entityHref(l.entityKey ?? "") : `/signals/${l.themeId}`)
const articles = (n: number) => `${fmtInt(n)} ${n === 1 ? "article" : "articles"}`
/** Label position as percent of the box: centred under the circle. */
const below = (n: Node) => ({ left: n.x * 100, top: ((n.y * H + nodeRadius(n.weight, max) + 2) / H) * 100 })
</script>

<div class="relative hidden md:block">
  {#if nodes.length < 2}
    <p class="dd-body text-ink-muted">Too few stories in this range to show how they connect.</p>
  {:else}
    <svg width="100%" viewBox="0 0 {W} {H}" class="block overflow-visible" aria-label={title}>
      <g stroke-linecap="round">
        {#each links as l (`${l.source}/${l.target}`)}
          {@const a = byId.get(l.source)}
          {@const b = byId.get(l.target)}
          {#if a && b}
            {@const ends = { x1: a.x * W, y1: a.y * H, x2: b.x * W, y2: b.y * H }}
            <a href={linkHref(l)} tabindex="-1" aria-label="{a.title} and {b.title}">
              <line
                {...ends}
                stroke-width={l.weight}
                class={hover === l.source || hover === l.target ? "stroke-ink-subtle" : "stroke-chart-axis"}
              />
              <line {...ends} stroke="transparent" stroke-width="10" />
            </a>
          {/if}
        {/each}
      </g>
      {#each nodes as n (n.id)}
        <a
          href="/stories/{n.id}"
          onpointerenter={() => (hover = n.id)}
          onpointerleave={() => (hover = null)}
          onfocus={() => (hover = n.id)}
          onblur={() => (hover = null)}
        >
          <title>{n.title}, {articles(n.weight)}</title>
          <circle
            cx={n.x * W}
            cy={n.y * H}
            r={nodeRadius(n.weight, max)}
            stroke-width="2"
            class="stroke-surface"
            style:fill={streamVar(n.stream)}
          />
        </a>
      {/each}
    </svg>

    {#each nodes as n (n.id)}
      {#if labelled.has(n.id) || hover === n.id}
        {@const at = below(n)}
        <span
          class={[
            "dd-body-sm pointer-events-none absolute max-w-48 -translate-x-1/2 truncate",
            hover === n.id ? "z-10 rounded-sm bg-surface px-1.5 text-ink shadow-sm" : "text-ink-muted",
          ]}
          style:left="{at.left}%"
          style:top="{at.top}%"
        >
          {n.title}
        </span>
      {/if}
    {/each}
  {/if}
</div>
