/** Bump when any number below changes; stored with feedback so ratings can be refit. */
export const CONFIG_VERSION = 1

export const FETCH = {
  timeoutMs: 15_000,
  userAgent: "daily-digest/0.1 (+https://dd.nipatiitti.fi)",
  /** Items older than this are dropped at fetch time, so a new feed doesn't backfill its archive. */
  maxItemAgeDays: 14,
  snippetChars: 500,
  /** Sources claimed per scheduler tick (sendBatch caps at 100 messages). */
  maxSourcesPerTick: 100,
}

export const EMBED = {
  model: "@cf/baai/bge-m3" as const,
  dimensions: 1024,
  /** Title plus lead, roughly 300 to 500 tokens. Never the LLM summary. */
  maxChars: 1500,
}

/** Article to story matching (brief section 5). All of these are (calibrate). */
export const MATCH = {
  /** Same origin (wire copy) when cosine is at least this... */
  copyCosine: 0.95,
  /** ...or title Jaccard is at least this. */
  copyTitleJaccard: 0.55,
  /** Join the best story automatically at or above this. */
  joinCosine: 0.85,
  /** Start a new story below this; in between, ask Haiku "same real-world event?". */
  newStoryCosine: 0.75,
  /** Used in the ask band when no LLM key is configured. */
  fallbackCosine: 0.8,
  topK: 20,
  /** How far back candidate articles may reach, by the incoming article's category. */
  windowHours: { security: 168, tech: 168, world: 72, fi: 72 } as Record<string, number>,
  /** Two articles from the same source have their distance multiplied by this. */
  sameSourcePenalty: 5,
}

/** Evidence bar for spending Sonnet on a story (brief section 6). */
export const EVIDENCE = {
  minIndependentOrigins: 2,
  /** One Tier A source or one Finnish-language source also clears the bar. */
  authoritativeCount: 1,
}
