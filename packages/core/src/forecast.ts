import { FORECAST } from "./config.ts"

/** Holt's linear (double exponential) smoothing: the next `horizon` values, floored at 0. */
export const holtLinear = (values: number[], opts: { alpha?: number; beta?: number; horizon?: number } = {}) => {
  const { alpha = FORECAST.alpha, beta = FORECAST.beta, horizon = FORECAST.horizonHours } = opts
  const [first = 0, second] = values
  if (second === undefined) return Array<number>(horizon).fill(Math.max(0, first))
  let level = first
  let trend = second - first
  for (const v of values.slice(1)) {
    const prev = level
    level = alpha * v + (1 - alpha) * (level + trend)
    trend = beta * (level - prev) + (1 - beta) * trend
  }
  return Array.from({ length: horizon }, (_, h) => Math.max(0, level + (h + 1) * trend))
}
