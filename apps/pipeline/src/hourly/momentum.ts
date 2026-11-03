import { HOURLY } from "@digest/core"
import { type Db, writeMomentum } from "@digest/db"

/** Momentum onto live threads and recently seen entities, items24h onto sources, all from rollups. After rollups. */
export const momentumStep = (db: Db, now: number) => writeMomentum(db, now, HOURLY.momentumWindows)
