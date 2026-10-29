import { HOURLY } from "@digest/core"
import { type Db, writeMomentum } from "@digest/db"

/** Momentum and origins30m onto stories, items24h onto sources. Runs after the rollup step. */
export const momentumStep = (db: Db, now: number) => writeMomentum(db, now, HOURLY.momentumWindows)
