/** Bump when any number below changes; stored with feedback so ratings can be refit. */
export const CONFIG_VERSION = 33

export const FETCH = {
  timeoutMs: 15_000,
  userAgent: "Mozilla/5.0 (compatible; daily-digest/0.1; +https://dd.nipatiitti.fi)",
  /** Items older than this are dropped at fetch time, so a new feed doesn't backfill its archive. */
  maxItemAgeDays: 14,
  snippetChars: 500,
  /** Sources claimed per scheduler tick (sendBatch caps at 100 messages). */
  maxSourcesPerTick: 100,
}

export const EMBED = {
  model: "@cf/baai/bge-m3" as const,
}

/**
 * Claude spend. MONTHLY_BUDGET_USD (a Worker var) is the month's budget over every purpose; each UTC day may spend
 * what the month has left spread over its remaining days (dailyAllowance in spend.ts), never more than maxDailyUsd.
 */
export const SPEND = {
  /** Used when MONTHLY_BUDGET_USD is unset. */
  monthlyBudgetUsd: 100,
  maxDailyUsd: 8,
  /** Above this share of today's allowance, the hourly threads, stories, coding, interest and movers steps skip. */
  softCapShare: 0.8,
}

export const DIGEST = {
  maxLinks: 3,
  /** UTC hours the two editions go out, at 20 past; the digest crons in apps/pipeline/wrangler.jsonc must match. */
  editions: { morning: 6, afternoon: 15 },
}

export const MAINTENANCE = {
  closeEventAfterDays: 7,
  dbWarnBytes: [4e9, 8e9],
}

/** Hourly loop at minute 0. Windows are in hours. */
export const HOURLY = {
  /** Hour buckets recounted each run (the current partial hour plus the two before it), so late articles land. */
  recomputeBuckets: 3,
  /** Momentum compares the last N complete hours with the N before: short is momentum_24h, long is momentum_7d. */
  momentumWindows: { short: 24, long: 168 },
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
  /**
   * An article joins only an event first seen at most this long before it, and consolidation merges only events first
   * seen this close together; a development that runs longer becomes a new event, which its thread links.
   */
  maxEventSpanHours: 72,
  /** Two articles from the same source have their distance multiplied by this. */
  sameSourcePenalty: 5,
  /** Added to an event's similarity per entity it shares with the article (places excluded), up to the max. */
  entityBoost: 0.02,
  entityBoostMax: 0.06,
  /** Member headlines shown to Haiku per event. */
  briefTitles: 5,
}

/** An event worth scoring and sending: independent origins from enough outlets, or one official source. */
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

/**
 * Stories: threads put hourly into running matters that last months or years. A thread is placed once; one kept out
 * of every story is asked again when its events reach recheckFactor times those it had then.
 */
export const STORIES = {
  /** Threads placed per run, latest article first, the rest waiting an hour. */
  maxThreadsPerRun: 40,
  /** Only threads with an article this recently are placed. */
  backfillDays: 14,
  recheckFactor: 2,
  /** Candidate stories shown to Haiku: those of threads sharing entities with the thread's latest events, then nearest. */
  maxCandidates: 10,
  /** Stories nearest the thread's centroid that become candidates. */
  nearestK: 8,
  /** The thread's latest events whose entities find candidate stories, and the entities they must share. */
  entityEvents: 2,
  sharedEntitiesMin: 2,
  /** Event titles shown per thread, and thread names shown per candidate story. */
  titlesPerThread: 4,
  examplesPerCandidate: 3,
  /** Nearest stories Sonnet sees when naming a proposal, so it can merge a duplicate instead. */
  namingNearest: 4,
  /** Stories with no new article for this long are closed; a joining thread reopens them. */
  closeAfterDays: 120,
  /** Closed stories stay candidates for this long after their last article. */
  reopenDays: 365,
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
  /** Without an official source among its members, an event needs origins from this many outlets in the last hour. */
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
  /** Stories on /threads?view=stories, and the latest thread names shown under each. */
  storyList: 100,
  storyThreads: 4,
  /** Hours of a subject's volume chart: two weeks, so the 7 day change has the week before. */
  chartHours: 336,
  timelineEvents: 50,
  /** Threads, entities and countries listed as related, most shared events first. */
  related: 12,
  deliveries: 50,
  /**
   * Ask: the question's gist neighbours (Vectorize allows 100 without metadata) published within its period, grouped
   * into their events. An event scores its best neighbour's similarity plus up to `askSupportWeight` for the others,
   * saturating as x / (x + askSupportHalf) over their summed similarity; the top `askEvents` are read.
   */
  askTopK: 100,
  askSupportWeight: 0.1,
  askSupportHalf: 1,
  askEvents: 20,
  /** Words of a question searched in thread names and descriptions, and threads found that way on top of the events'. */
  askTerms: 16,
  askThreads: 4,
  /** The period without a phrase naming one, the furthest any phrase reaches back, and how many "a few days" are. */
  askDays: 30,
  askMaxDays: 120,
  askFew: 3,
  /** Outlets named per event in the timeline under an answer. */
  askTimelineSources: 3,
  questionMaxChars: 500,
  answerMaxTokens: 1024,
  /** Claude spend per UTC day on answers when DASHBOARD_SPEND_CAP_USD is unset. */
  spendCapUsd: 2,
}

/**
 * Event coding: Haiku codes substantial events from their newest reports, profile-free, latest article first. An
 * event is coded again once its independent origins reach recodeOriginsFactor times those when coded, or grow after
 * recodeAfterHours.
 */
export const CODING = {
  perCall: 15,
  maxPerRun: 200,
  /** Events with an article this recently are coded hourly; older ones keep their code. */
  backfillDays: 21,
  recodeOriginsFactor: 2,
  recodeAfterHours: 24,
  /** Newest distinct titles and gists shown per event, origins first. */
  titlesPerEvent: 3,
  /** Entities offered as actors, most mentioned first, beside the event's countries. */
  entitiesPerEvent: 12,
}

/**
 * Interest: Haiku marks substantial events 0 to 3 against the profile, once per profile version and again once
 * origins double. It only lifts: an edition multiplies significance by boost[level].
 */
export const INTEREST = {
  /** The hourly run marks active events with an article this recently. */
  recentHours: 72,
  rescoreOriginsFactor: 2,
  /** Events marked per run, latest article first, the rest waiting an hour. */
  maxPerRun: 150,
  perCall: 15,
  /** Entity names shown per event, most mentioned first. */
  entitiesPerEvent: 12,
  boost: [1, 1.25, 1.5, 1.8] as readonly number[],
  /** An event touching a follow counts at least this level; a mute still holds it. */
  followLevel: 1,
}

/** Corroboration in code: how widely and how fast independent outlets report an event, 0 to 1. */
export const RANKING = {
  /**
   * Importance parts saturate as x / (x + half): independent origin outlets, their distinct home countries, distinct
   * sources, and origin outlets in the last velocityHours.
   */
  originsHalf: 3,
  countriesHalf: 2,
  sourcesHalf: 3,
  velocityHalf: 2,
  /** Origins published this long before an event's latest article count as its velocity. */
  velocityHours: 6,
  /** Weights of those parts (sum 1), and the bonus for an official source; importance is capped at 1. */
  weights: { origins: 0.4, countries: 0.25, sources: 0.15, velocity: 0.2 },
  officialBonus: 0.2,
  freshnessHalfLifeHours: 18,
}

/**
 * The digest edition: candidates are grouped by story (else thread, else event). A group's gate is its best material
 * event's significance times INTEREST.boost for its interest, at most 100. A group goes out when the gate reaches
 * minSignificance and, for a story, its change since the last brief is major. Items rank by
 * gate / 100 x corroboration x freshness, at most maxItems, with no minimum.
 */
export const EDITION = {
  /** Candidates changed since the previous edition, or within this window before the first one. */
  windowHours: 30,
  /** However long ago the previous edition was, candidates reach back at most this far. */
  maxLookbackHours: 72,
  minSignificance: 60,
  /** A muted event still goes out from this significance, before the boost. */
  muteOverride: 75,
  maxItems: 8,
  /** Groups past maxItems whose copy is written too, standing in for items the copy skips as talk. */
  copySpare: 5,
  /** Copy rounds while skips leave the edition short and qualified groups remain. */
  copyRounds: 2,
  /**
   * Items rank by significance x boost ^ rankBoost, not by the gate: the boost lifts a niche item over the bar at full
   * strength but orders it among the rest at its square root, so interests cannot crowd the world out.
   */
  rankBoost: 0.5,
  /** Corroboration is floor + (1 - floor) x importance, so one strong outlet is not ruled out. */
  corroborationFloor: 0.6,
  /** Member reports, origins first, whose titles and gists Sonnet sees per item. */
  copyReports: 6,
  /** Countries a tag names when the item has no story or active thread. */
  tagCountries: 2,
}

/** The story change judgment: one Haiku call per perCall story groups that clear the gate, no profile. */
export const JUDGE = {
  perCall: 8,
  /** Output tokens: a base plus this per story, for its carriers and reason. */
  baseTokens: 1024,
  tokensPerStory: 320,
  /** Coded events shown per story group, material first, then by significance. */
  eventsPerGroup: 8,
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
