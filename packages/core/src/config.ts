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
