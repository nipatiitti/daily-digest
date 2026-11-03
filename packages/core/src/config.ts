/** Bump when any number below changes; stored with feedback so ratings can be refit. */
export const CONFIG_VERSION = 24

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
  /**
   * Start a new story below this; in between, ask Haiku which candidate story, if any, the article belongs to.
   * Cross-language reports of one event sit around 0.6, so the band starts below them.
   */
  newStoryCosine: 0.55,
  /** Candidate stories in the ask band offered to Haiku in one call, best first. */
  askCandidates: 3,
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
  /** Score bands; crossing one is a material update. */
  tierBounds: [45, 60, 75, 90],
  /** EPSS at or above this counts toward security majorness. */
  epssMajor: 0.1,
}

/** Alert gate (brief section 6). Shadow mode for the first two weeks. */
export const ALERT = {
  shadow: true,
  minScore: 90,
  /** Non-authoritative world stories also need this many independent outlets within the window. */
  worldVelocityOrigins: 4,
  worldVelocityWindowMinutes: 30,
  /** Material update: one new or contradicting fact of a key type with at least this salience... */
  materialSalience: 3,
  /** ...or this many new or contradicting key type facts of distinct types, each with salience one below that. */
  materialKeyFacts: 2,
  materialOriginJump: 5,
}

/** Digest composition (brief section 7). */
export const DIGEST = {
  floor: 60,
  fiFloor: 45,
  /** Added to a Finland story's score for ranking only. */
  finlandBoost: 8,
  /** Security and tech share one group. Finland means the title or an extracted entity names a place in Finland. */
  slots: { techSecurity: 3, world: 2, fi: 2 },
  /** A story whose origins all come from advisory sources needs this score. */
  advisoryFloor: 80,
  maxItems: 7,
  maxPerSource: 2,
  /** Candidates are stories that changed within this window before the run. */
  windowHours: 30,
  maxLinks: 3,
  /** UTC hours the two editions go out; the digest crons in apps/pipeline/wrangler.jsonc must match. */
  editions: { morning: 6, afternoon: 15 },
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
  /**
   * v1 story merge pass, first in the hourly loop. Each active story first seen within `recentHours` looks up the
   * `topK` nearest articles to its lead article; a close story in the same topic group merges outright on a wire copy
   * cosine or title, otherwise after Haiku says it is the same story. At most `maxAsksPerRun` asks per run.
   */
  merge: { recentHours: 48, topK: 10, maxAsksPerRun: 20 },
}

/** Entity keys: ingest folds facet entity names into `entities` by normaliseEntityKey. */
export const ENTITIES = {
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

/** v2 ingest: one Haiku facet pass per article before clustering. */
export const FACETS = {
  /** Minutes between the minute cron's backlog checks; a full ingest run wakes the next one itself. */
  stallCheckMinutes: 15,
  /** Oldest un-ingested articles taken per facet-q run. */
  perRun: 50,
  /** Articles per Haiku call. */
  perCall: 20,
  /** Facets may spend up to this multiple of the daily cap, so ingest keeps up while other calls stop. */
  capMultiplier: 1.25,
  /** Entities kept per article; the output token budget grows with it. */
  maxEntities: 8,
}

/** Article to event clustering over gist vectors (English for every language). All of these are (calibrate). */
export const CLUSTER = {
  /** Same origin (wire copy) when cosine is at least this, or the English titles' Jaccard is at least this. */
  copyCosine: 0.95,
  copyTitleJaccard: 0.55,
  /** Join the best event automatically at or above this. */
  joinCosine: 0.86,
  /** Start a new event below this; in between, Haiku picks among the best few candidates. */
  askCosine: 0.62,
  askCandidates: 3,
  /** Used in the ask band without an LLM, or when the call is capped or refused. */
  fallbackCosine: 0.8,
  topK: 20,
  /** How far either side of the article's publish time neighbours may sit, for every topic. */
  windowHours: 168,
  /** Two articles from the same source have their distance multiplied by this. */
  sameSourcePenalty: 5,
  /** Added to an event's similarity per entity it shares with the article (places excluded), up to the max. */
  entityBoost: 0.02,
  entityBoostMax: 0.06,
  /** Member headlines shown to Haiku per event. */
  briefTitles: 5,
}

/** An event worth scoring and sending: enough independent origins, or one official source. */
export const SUBSTANTIAL = {
  minOrigins: 2,
  minOfficial: 1,
}

/**
 * Hourly consolidation: active events first seen within `recentHours` and updated since the last run, at most
 * `maxEventsPerRun` newest updated first, look up the `topK` articles nearest their centroid. Another active event at
 * `mergeCosine` by centroid, or with a copied title from `askCosine`, merges outright; from `askCosine` Haiku decides,
 * at most `maxAsksPerRun` times a run, highest cosine first. At most `maxMergesPerRun` merges a run.
 */
export const CONSOLIDATE = {
  recentHours: 72,
  topK: 20,
  mergeCosine: 0.93,
  askCosine: 0.72,
  maxAsksPerRun: 30,
  maxEventsPerRun: 300,
  maxMergesPerRun: 50,
}

/** Threads: substantial events joined hourly into named developments that span days or weeks. */
export const THREADS = {
  /** Candidate threads shown to Haiku per event, entity matches first. */
  maxCandidates: 12,
  /** Threads nearest the event's centroid by cosine that become candidates. */
  nearestK: 10,
  /** Entities a thread's events must share with the event to make it a candidate. */
  sharedEntitiesMin: 2,
  /** Entity names shown to the model per event, most mentioned first. */
  entitiesPerEvent: 12,
  /** A provisional thread becomes active, and visible, with this many events. */
  visibleEvents: 2,
  /** Threads with no new article for this long are closed; a joining event reopens them. */
  closeAfterDays: 30,
  /** Closed threads stay candidates for this long after their last article. */
  reopenDays: 90,
  /** Event titles shown to the model under each candidate thread. */
  examplesPerCandidate: 2,
  /** Events threaded per run, oldest first, the rest waiting an hour. */
  maxEventsPerRun: 30,
  /** Only events first seen this recently are threaded. */
  backfillDays: 14,
  /** Nearest threads Sonnet sees when naming a proposal, so it can merge a duplicate instead. */
  namingNearest: 3,
}

/** The hour's top movers on the home page: threads, entities and countries whose article volume rose most. */
export const MOVERS = {
  /** Articles a subject needs in the last 24 hours, so 1 article becoming 2 is not a mover. */
  minArticles: 3,
  /** Movers kept per hour. */
  top: 12,
  /** The first this many get a one-line reason from Haiku. */
  reasons: 5,
  /** Titles of the subject's events with the most articles in the window, shown to Haiku per mover. */
  eventTitles: 3,
  /** Movers rows older than this are deleted. */
  keepDays: 7,
}

/** Nightly reactions: the votes cast since the last run become one profile proposal. */
export const REACTIONS = {
  /** The first run reads every vote; later runs reach at most this far back. */
  lookbackDays: 7,
  /** Fewer new votes than this wait for another night. */
  minVotes: 3,
  /** Profile edits kept from one proposal. */
  maxEdits: 5,
}

/** Alerts outside the editions for followed threads and entities, sent only when EDITION.mode is "send". */
export const ALERTS = {
  /** Candidates had an article this recently. */
  lookbackHours: 2,
  /** Without an official source among its members, an event needs this many origins published in the last hour. */
  minOrigins1h: 4,
  /** No second alert on the same followed thread or entity within this. */
  cooldownHours: 24,
  /** Per UTC day. */
  maxPerDay: 3,
  /** Helsinki hours in which alerts are sent silently. */
  quietHours: { start: 23, end: 7 },
}

/** The reader pages: Home, threads, entities, countries and events, and the question box on Home. */
export const HOME = {
  /** A visit this soon after the last one keeps the "since you last looked" time; a first visit looks back a day. */
  visitGapMinutes: 30,
  firstVisitHours: 24,
  /** Followed events read, and the substantial ones of those listed. */
  sinceScan: 100,
  sinceEvents: 20,
  movers: 10,
  /** Hours in a list sparkline. */
  sparkHours: 24,
  /** Threads on /threads; under 95 so their sparklines fit one rollup read. */
  threadList: 90,
  /** Hours of a subject's volume chart: two weeks, so the 7 day change has the week before. */
  chartHours: 336,
  timelineEvents: 50,
  /** Threads, entities and countries listed as related, most shared events first. */
  related: 12,
  deliveries: 50,
  /** Words of a question searched, threads and events read for it, and how recent an event must be. */
  askTerms: 16,
  askThreads: 8,
  askEvents: 40,
  askEventsShown: 15,
  askDays: 7,
  questionMaxChars: 500,
  answerMaxTokens: 1024,
  /** Claude spend per UTC day on answers when DASHBOARD_SPEND_CAP_USD is unset. */
  spendCapUsd: 2,
}

/** Haiku scores substantial events against the current profile: once per profile version, again once origins double. */
export const RELEVANCE = {
  /** The hourly run scores active events with an article this recently. */
  recentHours: 72,
  /** An event is scored again once its independent origins reach this multiple of those at the last score. */
  rescoreOriginsFactor: 2,
  /** Events scored per run, latest article first, the rest waiting an hour. */
  maxPerRun: 150,
  /** Events per Haiku call. */
  perCall: 10,
  /** Entity names shown per event, most mentioned first. */
  entitiesPerEvent: 12,
}

/** Ranking in code: relevance / 100 x importance x freshness x vote penalty. */
export const RANKING = {
  /** Importance parts saturate as x / (x + half): origins, distinct sources and origins in the last velocityHours. */
  originsHalf: 3,
  sourcesHalf: 3,
  velocityHalf: 2,
  /** Origins published this long before an event's latest article count as its velocity. */
  velocityHours: 6,
  /** Weights of those parts (sum 1), and the bonus for an official source; importance is capped at 1. */
  weights: { origins: 0.5, sources: 0.3, velocity: 0.2 },
  officialBonus: 0.2,
  freshnessHalfLifeHours: 18,
  /** Each net downvote on the event's thread or an entity takes this off, down to the floor; the worst one counts. */
  votePenaltyPerDown: 0.15,
  votePenaltyFloor: 0.4,
  voteWindowDays: 30,
}

/** The v2 digest edition. */
export const EDITION = {
  /** "shadow" writes digests_shadow beside the v1 digest; "send" replaces v1 and turns alerts on. */
  mode: "shadow" as "shadow" | "send",
  /** Candidates changed since the previous edition, or within this window before the first one. */
  windowHours: 30,
  /** However long ago the previous edition was, candidates reach back at most this far. */
  maxLookbackHours: 72,
  minRelevance: 40,
  /** An advisory-only event needs this unless it touches a follow. */
  advisoryMinRelevance: 80,
  /** A thread sent in this many latest editions cools, unless its origins reached the factor or it ranks top half. */
  threadCooldownEditions: 2,
  cooldownOriginsFactor: 2,
  /** Top candidates offered to the Haiku cut, which keeps between minItems and maxItems. */
  candidates: 15,
  minItems: 5,
  maxItems: 8,
  /** Member reports, origins first, whose titles and gists Sonnet sees per event. */
  copyReports: 6,
  /** Countries a tag names when the event has no active thread. */
  tagCountries: 2,
}

/** The status, profile and digest archive pages. */
export const STATUS = {
  /** UTC days of Claude spend charted, today last. */
  spendDays: 14,
  /** Hours of same-event decisions and placements counted for clustering health. */
  clusterHours: 24,
  /** An hourly step or loop write older than this shows stale. */
  loopStaleHours: 2,
  /** Latest editions listed. */
  editions: 10,
  /** Profile versions listed, newest first, and empty topic rows offered for adding. */
  profileHistory: 30,
  newTopicRows: 3,
  /** UTC days of digest editions per archive page. */
  digestPageDays: 30,
}

/** Size limits on the profile form, so one save cannot bloat every profile-aware prompt or a D1 row. */
export const PROFILE = {
  textMaxChars: 4000,
  maxTopics: 40,
  topicMaxChars: 80,
  mutesMaxChars: 4000,
  /** Follows of all kinds together; the follow queries bind one parameter each under D1's 100. */
  maxFollows: 60,
}
