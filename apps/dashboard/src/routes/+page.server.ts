import { HOME, HOUR_MS } from "@digest/core"
import type { PageServerLoad } from "./$types"

const COOKIE = "home_seen"
/** The longest browsers keep a cookie. */
const KEEP_SECONDS = 400 * 86_400

/**
 * When the reader last looked, kept in a cookie as "since,latest visit". A visit within HOME.visitGapMinutes of the
 * latest one is the same visit, so a reload keeps its "since"; a first visit looks back HOME.firstVisitHours.
 */
export const load: PageServerLoad = ({ cookies }) => {
  const now = Date.now()
  // A value that is not a safe positive integer no later than now counts as missing.
  const [since, latest] = (cookies.get(COOKIE) ?? "")
    .split(",")
    .map(Number)
    .map((t) => (Number.isSafeInteger(t) && t > 0 && t <= now ? t : undefined))
  const same = latest !== undefined && now - latest < HOME.visitGapMinutes * 60_000
  const from = (same ? since : latest) ?? now - HOME.firstVisitHours * HOUR_MS
  cookies.set(COOKIE, `${from},${now}`, { path: "/", httpOnly: true, sameSite: "lax", maxAge: KEEP_SECONDS })
  return { since: from }
}
