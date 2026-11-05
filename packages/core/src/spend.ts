import { SPEND } from "./config.ts"
import { DAY_MS } from "./rollup.ts"

/** Start of the UTC day and of the UTC month `now` falls in, and the days left in the month, today included. */
export const spendCalendar = (now: number) => {
  const d = new Date(now)
  const day = now - (now % DAY_MS)
  const month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  return { day, month, daysLeft: Math.round((next - day) / DAY_MS) }
}

/**
 * Today's Claude allowance from the month's budget: what the month has not spent before today, spread evenly over the
 * days left, so a cheap day leaves more for the rest of the month and an expensive one less. `remaining` is what the
 * month has left before today; no day may take more than SPEND.maxDailyUsd.
 */
export const dailyAllowance = (monthlyBudgetUsd: number, spentBeforeToday: number, now: number) => {
  const remaining = Math.max(0, monthlyBudgetUsd - spentBeforeToday)
  const { daysLeft } = spendCalendar(now)
  return { remaining, allowance: Math.min(SPEND.maxDailyUsd, remaining / daysLeft) }
}
