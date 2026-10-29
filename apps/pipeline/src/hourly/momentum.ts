import { ALERT, HOURLY } from "@digest/core"
import { type Db, writeEntityMomentum, writeMomentum, writeThemeMomentum } from "@digest/db"

/**
 * Momentum and origins30m (decay only, process keeps it fresh) onto stories, items24h onto sources, momentum onto
 * recently seen entities and themes. After rollups.
 */
export const momentumStep = async (db: Db, now: number) => ({
  ...(await writeMomentum(db, now, {
    windows: HOURLY.momentumWindows,
    velocityWindowMinutes: ALERT.worldVelocityWindowMinutes,
  })),
  ...(await writeEntityMomentum(db, now, HOURLY.momentumWindows)),
  ...(await writeThemeMomentum(db, now, HOURLY.momentumWindows)),
})
