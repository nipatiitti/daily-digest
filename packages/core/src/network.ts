import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force"
import { DASHBOARD } from "./config.ts"

/** A story in the network; `weight` is its article count. */
export type NetworkNode = { id: number; weight: number }

/** Two stories that share signals or entities; `weight` is 1 to DASHBOARD.networkMaxLinkWeight. */
export type NetworkLink = { source: number; target: number; weight: number }

/** A node placed in the unit box: x and y run 0 to 1 across DASHBOARD.networkWidth by networkHeight. */
export type PlacedNode<N extends NetworkNode = NetworkNode> = N & { x: number; y: number }

type Sim = NetworkNode & SimulationNodeDatum

const { networkWidth: W, networkHeight: H } = DASHBOARD

/** A node's radius in layout units, on a sqrt scale up to the heaviest node's weight `max`. */
export const nodeRadius = (weight: number, max: number) =>
  DASHBOARD.networkMinRadius +
  (DASHBOARD.networkMaxRadius - DASHBOARD.networkMinRadius) * Math.sqrt(weight / Math.max(1, max))

/** mulberry32: a uniform [0, 1) source from a 32-bit seed. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Places the nodes with a force layout run for DASHBOARD.networkTicks on the server, kept inside the layout box. The
 * same nodes, links and seed give the same layout: inputs are sorted and the only randomness is the seeded source.
 * Every link must join two of the nodes. Nodes come back sorted by id.
 */
export const layoutNetwork = <N extends NetworkNode>(nodes: N[], links: NetworkLink[], seed: number) => {
  const sorted = nodes.toSorted((a, b) => a.id - b.id)
  const sim: Sim[] = sorted.map((n) => ({ id: n.id, weight: n.weight }))
  const edges = links
    .toSorted((a, b) => a.source - b.source || a.target - b.target || a.weight - b.weight)
    .map((l) => ({ source: l.source, target: l.target, weight: l.weight }))
  const max = Math.max(1, ...sorted.map((n) => n.weight))
  const radius = (n: NetworkNode) => nodeRadius(n.weight, max)
  const simulation = forceSimulation(sim)
    .randomSource(mulberry32(seed))
    .stop()
    .force(
      "link",
      forceLink<Sim, NetworkLink>(edges)
        .id((n) => n.id)
        .distance((l) => DASHBOARD.networkLinkDistance / l.weight),
    )
    .force("charge", forceManyBody().strength(DASHBOARD.networkCharge))
    .force("x", forceX(0).strength(DASHBOARD.networkGravity))
    .force("y", forceY(0).strength((DASHBOARD.networkGravity * W) / H))
    .force(
      "collide",
      forceCollide<Sim>((n) => radius(n) + DASHBOARD.networkCollidePadding),
    )
  for (let i = 0; i < DASHBOARD.networkTicks; i++) {
    simulation.tick()
    for (const n of sim) {
      const r = radius(n)
      n.x = clamp(n.x ?? 0, r - W / 2, W / 2 - r)
      n.y = clamp(n.y ?? 0, r - H / 2, H / 2 - r)
    }
  }
  return sorted.map((n, i): PlacedNode<N> => ({ ...n, x: (sim[i]?.x ?? 0) / W + 0.5, y: (sim[i]?.y ?? 0) / H + 0.5 }))
}
