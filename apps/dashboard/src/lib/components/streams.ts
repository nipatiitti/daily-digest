import type { Category } from "@digest/db"

/** Fixed colour slots (`--stream-<n>`). A slot is never reused or re-ordered; a new stream takes the next free one. */
const STREAM_SLOTS = { world: 1, tech: 2, security: 3, fi: 4 } as const satisfies Record<Category, number>

export const STREAM_NAMES: Record<Category, string> = {
  world: "World",
  tech: "Tech",
  security: "Security",
  fi: "Finland",
}

export const streamSlot = (category: Category) => STREAM_SLOTS[category]
