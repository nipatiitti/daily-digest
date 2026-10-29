import { ALERT, HOURLY } from "@digest/core"
import { type Db, writeMomentum } from "@digest/db"

/** Momentum and origins30m (decay only, process keeps it fresh) onto stories, items24h onto sources. After rollups. */
export const momentumStep = (db: Db, now: number) =>
  writeMomentum(db, now, { windows: HOURLY.momentumWindows, velocityWindowMinutes: ALERT.worldVelocityWindowMinutes })
