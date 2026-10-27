/** Model IDs and first-party prices (USD per million tokens), checked 27 Oct 2026. */
export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const

export type ModelId = (typeof MODELS)[keyof typeof MODELS]

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<ModelId, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export const estimateCostUsd = (model: ModelId, u: Usage) => {
  const p = PRICES[model]
  const cached = u.cache_read_input_tokens ?? 0
  const written = u.cache_creation_input_tokens ?? 0
  return (
    (u.input_tokens * p.input + u.output_tokens * p.output + cached * p.cacheRead + written * p.cacheWrite) / 1_000_000
  )
}
