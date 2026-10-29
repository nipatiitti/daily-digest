/** Bump when any number below changes; stored with feedback so ratings can be refit. */
export const CONFIG_VERSION = 11

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

/** Entities folded hourly from StoryEval's extraction into `entities` and `story_entities`. */
export const ENTITIES = {
  /** Links kept per story: the primary entity first, then the extraction's order, then CVEs. */
  maxPerStory: 24,
  /** The first run folds stories evaluated this far back; later runs never reach further. */
  backfillDays: 14,
  /** Runs re-read evaluations this far before the cursor: entities are saved after the LLM call is logged. */
  rescanHours: 1,
  /** Stories folded per run, the rest waiting an hour; keeps one run's D1 statements in the low hundreds. */
  maxStoriesPerRun: 200,
  /** Trailing words dropped from keys, so "Nokia Oyj" and "Nokia" are one entity. */
  suffixes: [
    "inc",
    "ltd",
    "llc",
    "plc",
    "oy",
    "oyj",
    "ab",
    "as",
    "gmbh",
    "ag",
    "sa",
    "corporation",
    "corp",
    "co",
    "company",
    "group",
    "holdings",
  ] as readonly string[],
}

/** Themes: stories joined hourly into named developments that span days or weeks. */
export const THEMES = {
  /** Candidate themes shown to Haiku per story, entity matches first. */
  maxCandidates: 12,
  /** Themes nearest the story's embedding by cosine that become candidates. */
  nearestK: 10,
  /** Entities a theme's stories must share with the story to make it a candidate. */
  sharedEntitiesMin: 2,
  /** A provisional theme becomes visible with this many stories... */
  visibleStories: 2,
  /** ...or with one story scoring at least this. */
  visibleScore: 60,
  /** Themes with no new story for this long are closed; a joining story reopens them. */
  closeAfterDays: 30,
  /** Story titles shown to the model under each candidate theme. */
  examplesPerCandidate: 2,
  /** Stories themed per run, the rest waiting an hour. */
  maxStoriesPerRun: 100,
  /** Runs re-read stories this far before the cursor, as ENTITIES does. */
  rescanHours: 1,
  /** The first run themes stories this far back; later runs never reach further. */
  backfillDays: 14,
  /** Nearest themes Sonnet sees when naming a proposal, so it can merge a duplicate instead. */
  namingNearest: 3,
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

/** Dashboard header lamps. */
export const LAMPS = {
  /** Fetch lamp: newest item older than this is stale, older than off is off. */
  fetchStaleMinutes: 30,
  fetchOffMinutes: 180,
  /** Eval lamp: stories extracted but not yet scored. */
  evalBacklogStale: 5,
  evalBacklogAlert: 20,
  /** Spend lamp: stale at this percent of DAILY_SPEND_CAP_USD, alert at 100. */
  spendStalePct: 80,
}

/** Dashboard front page and story list. */
export const DASHBOARD = {
  /** Points in a sparkline: readouts split their window into this many, story cards show this many hours. */
  readoutSparkPoints: 24,
  /** Stories on the front page, the lead included. */
  topStories: 7,
  chartHeight: 340,
  /** Rows on the story and entity lists. */
  storiesPageSize: 50,
  /** Facts listed under the lead story. */
  leadFacts: 5,
  /** Rows per list on the story and article pages: articles, facts, match log, gate log, deliveries, signals, audit. */
  storyPageRows: 200,
  /** The story and entity pages' charts show at most this many days. */
  storyChartDays: 14,
  /** Stories listed on an entity page, newest first. */
  entityPageStories: 30,
  /** Entity series the front page chart draws beside the streams, in colour slots 5 to 8. */
  seriesPickerMax: 4,
  /** Search hits the series picker lists, and how long it waits after a keystroke before searching. */
  seriesPickerHits: 8,
  searchDebounceMs: 200,
  /** Rows in one CSV download from the table browser. */
  exportMaxRows: 10_000,
  /** Rows per page in the table browser. */
  browsePageSize: 100,
}
