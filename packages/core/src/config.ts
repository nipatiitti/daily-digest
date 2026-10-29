/** Bump when any number below changes; stored with feedback so ratings can be refit. */
export const CONFIG_VERSION = 3

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
  /** Lowered from 0.75 so cross-language reports of one event reach the Haiku ask instead of a new story. */
  newStoryCosine: 0.65,
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

/** Story evaluation (brief section 6). */
export const EVAL = {
  /** Origin articles whose full text is fetched for extraction, authoritative first. */
  fulltextArticles: 2,
  fulltextMaxChars: 12_000,
  fetchTimeoutMs: 15_000,
  /** Above this share of the daily cap, stories without a Tier A source are not extracted. */
  spendSoftCap: 0.8,
  /** Tier A stories may spend up to this multiple of the cap (the alert path stays alive). */
  tierACapMultiplier: 1.25,
  /** Stored facts a new fact is labelled against. */
  noveltyContextFacts: 5,
}

/** Rubric weights (sum 1), caps and the score formula (brief section 6). All (calibrate). */
export const SCORING = {
  weights: {
    severity: 0.25,
    specificity: 0.2,
    breadth: 0.2,
    actionability: 0.15,
    novelty: 0.1,
    credibility: 0.1,
  } as Record<string, number>,
  caps: { promotional: 74, aggregator: 40, evergreen: 60 },
  credibilityByTier: { A: 1, B: 0.95, C: 0.8, D: 0.7 } as Record<string, number>,
  unknownCredibility: 0.7,
  recencyHalfLifeHours: 18,
  originBonusMax: 15,
  /** Bonus per independent origin seen in the last 6 hours, capped. */
  velocityBonusPerOrigin: 2,
  velocityBonusMax: 10,
  /** Applied to digest ranking only: fi_relevance 2 and 1. */
  nordicBoost: { 2: 8, 1: 4 } as Record<number, number>,
  /** Score bands; crossing one is a material update. */
  tierBounds: [45, 60, 75, 90],
  /** EPSS at or above this counts toward security majorness. */
  epssMajor: 0.1,
}

/** Alert gate (brief section 6). Shadow mode for the first two weeks. */
export const ALERT = {
  shadow: true,
  minScore: 90,
  maxPerDay: 3,
  cooldownDevelopingHours: 4,
  cooldownSustainedHours: 24,
  /** Non-authoritative world stories also need this many independent outlets within the window. */
  worldVelocityOrigins: 4,
  worldVelocityWindowMinutes: 30,
  /** Helsinki quiet hours: send silently unless authoritative and exploited. */
  quietHours: { start: 23, end: 7 },
  /** Material update: a new or contradicting fact of a key type with at least this salience. */
  materialSalience: 2,
  materialOriginJump: 5,
}

/** Digest composition (brief section 7). */
export const DIGEST = {
  floor: 60,
  fiFloor: 45,
  /** Security and tech share one group. Finland means fi_nordic_eu_relevance 2, any topic. */
  slots: { techSecurity: 3, world: 2, fi: 2 },
  maxItems: 7,
  maxPerEntity: 1,
  maxPerSource: 2,
  /** Candidates are stories that changed within this window before the run. */
  windowHours: 30,
  maxLinks: 3,
  /** Before slotting, the top candidates are checked pairwise for the same event and merged. */
  dedupeTop: 14,
}

export const MAINTENANCE = {
  closeStoryAfterDays: 7,
  /** Unassigned articles this recent are put back on process-q nightly. */
  requeueWindowDays: 2,
  requeueLimit: 500,
  dbWarnBytes: [4e9, 8e9],
}

/** Hourly loop at minute 0. Windows are in hours. */
export const HOURLY = {
  /** Hour buckets recounted each run (the current partial hour plus the two before it), so late articles land. */
  recomputeBuckets: 3,
  /** Momentum compares the last N complete hours with the N before: short is momentum_24h, long is momentum_7d. */
  momentumWindows: { short: 24, long: 168 },
}

/** Holt linear forecast over hourly counts. */
export const FORECAST = {
  /** Level smoothing: higher follows the latest hour more closely. */
  alpha: 0.5,
  /** Trend smoothing: higher reacts faster to a change in slope. */
  beta: 0.3,
  /** Hours forecast ahead. */
  horizonHours: 24,
  /** Hours of history fed to the forecast. */
  historyHours: 72,
}
