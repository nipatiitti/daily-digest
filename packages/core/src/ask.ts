import { HOME } from "./config.ts"
import { DAY_MS, HOUR_MS } from "./rollup.ts"

/** What a question asks about: from `from`, until `to` or up to now when `to` is null, both unix ms. */
export type AskPeriod = { from: number; to: number | null }

const startOfDay = (ms: number) => ms - (ms % DAY_MS)
/** Monday 00:00 UTC of the week holding `ms`. */
const startOfWeek = (ms: number) => startOfDay(ms) - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS
const startOfMonth = (ms: number, back = 0) => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)
}

/** A word boundary that knows ä and ö are letters, which `\b` does not. */
const B = String.raw`(?:(?<=[\p{L}\p{N}])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]))`
/** A pattern written with `\b` and `_` for a space, matched against the lowercased question. */
const re = (src: string) => new RegExp(src.replaceAll(String.raw`\b`, B).replaceAll("_", " "), "u")

/** Calendar phrases in English and Finnish, the more specific first; each gives its period as of `now`. */
const CALENDAR: [RegExp, (now: number) => AskPeriod][] = [
  [
    re(String.raw`\bday_before_yesterday\b|\btoissapäivänä\b`),
    (n) => ({ from: startOfDay(n) - 2 * DAY_MS, to: startOfDay(n) - DAY_MS }),
  ],
  [re(String.raw`\byesterday\b|\beilen\b|\beilisen\b`), (n) => ({ from: startOfDay(n) - DAY_MS, to: startOfDay(n) })],
  [
    re(
      String.raw`\b(today|tonight|this_(morning|afternoon|evening))\b|\btänään\b|\btämän_päivän\b|\btänä_(aamuna|iltana)\b`,
    ),
    (n) => ({ from: startOfDay(n), to: null }),
  ],
  [
    // "the last week" is the past seven days, left to the rolling periods.
    re(String.raw`(?<!the_)\b(last|previous)_week\b|\b(viime|edellisellä|edellisen)_(viikolla|viikon)\b`),
    (n) => ({ from: startOfWeek(n) - 7 * DAY_MS, to: startOfWeek(n) }),
  ],
  [re(String.raw`\bthis_week\b|\btällä_viikolla\b|\btämän_viikon\b`), (n) => ({ from: startOfWeek(n), to: null })],
  [
    re(
      String.raw`(?<!the_)\b(last|previous)_month\b|\b(viime|edellisessä|edellisen)_(kuussa|kuun|kuukautena|kuukauden)\b`,
    ),
    (n) => ({ from: startOfMonth(n, 1), to: startOfMonth(n) }),
  ],
  [
    re(String.raw`\bthis_month\b|\btässä_kuussa\b|\btällä_kuulla\b|\btämän_(kuun|kuukauden)\b|\btänä_kuukautena\b`),
    (n) => ({ from: startOfMonth(n), to: null }),
  ],
  [
    re(String.raw`\bthis_year\b|\btänä_vuonna\b|\btämän_vuoden\b`),
    (n) => ({ from: Date.UTC(new Date(n).getUTCFullYear(), 0, 1), to: null }),
  ],
]

/** Number words up to ten in English and in the Finnish cases a period takes. */
const NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  yhden: 1,
  pari: 2,
  parin: 2,
  kaksi: 2,
  kahden: 2,
  kolme: 3,
  kolmen: 3,
  neljä: 4,
  neljän: 4,
  viisi: 5,
  viiden: 5,
  kuusi: 6,
  kuuden: 6,
  seitsemän: 7,
  kahdeksan: 8,
  yhdeksän: 9,
  kymmenen: 10,
}
/** Counts that mean HOME.askFew. */
const FEW = new Set(["few", "several", "muutama", "muutaman", "useamman"])

/** The length of a unit of time, in English or by its Finnish stem. */
const unitMs = (u: string) =>
  /^(hour|tun[nt])/.test(u)
    ? HOUR_MS
    : /^(day|päiv)/.test(u)
      ? DAY_MS
      : /^(week|viik)/.test(u)
        ? 7 * DAY_MS
        : /^(month|kuukau)/.test(u)
          ? 30 * DAY_MS
          : null

/** Plural forms without a count, such as "recent days" or "viime päivinä", mean a few of them. */
const PLURAL = /^(hours|days|weeks|months|päivi|viikkoi|viikkoj|kuukausina|kuukausia|tuntei|tunteja)/u

const UNIT = String.raw`((?:hours?|days?|weeks?|months?)\b|(?:tun[nt]|päiv|viik|kuukau)\p{L}*)`
const COUNT = String.raw`(\d{1,3}|\p{L}+)`
const QUALIFIER = "(?:past|last|previous|recent|kuluneen|kuluneella|kuluneiden|viimeisen|viimeiset|viimeisten|viime)"

/** A count and a unit: "past 10 days", "last couple of weeks", "viimeisen 10 päivän", "kahden viime viikon", "48 hours". */
const COUNTED = [
  re(String.raw`\b${QUALIFIER}_${COUNT}_(?:of_)?${UNIT}`),
  re(String.raw`\b${COUNT}_${QUALIFIER}_${UNIT}`),
  re(String.raw`\b(\d{1,3})_?${UNIT}`),
]
/** A unit with no count: "past week", "recent days", "kuluneen viikon", "viime päivinä". */
const UNCOUNTED = re(String.raw`\b${QUALIFIER}_${UNIT}`)

/** The period back from `now` for a count (a numeral or a number word, undefined for none) of a unit. */
const rolling = (count: string | undefined, unit: string, now: number): AskPeriod | null => {
  const ms = unitMs(unit)
  if (ms === null) return null
  let n: number
  if (count === undefined) n = PLURAL.test(unit) ? HOME.askFew : 1
  else if (/^\d+$/.test(count)) n = Number(count)
  else if (FEW.has(count)) n = HOME.askFew
  else if (count in NUMBERS) n = NUMBERS[count] ?? 1
  else return null
  return n > 0 ? { from: now - n * ms, to: null } : null
}

/**
 * The period a question asks about, read from simple phrases in English and Finnish (today, yesterday, this week,
 * last month, past 10 days, tänään, eilen, viime viikolla, tässä kuussa, viimeisen 10 päivän), in UTC days with weeks
 * from Monday. Without one it is the last HOME.askDays; it never reaches back more than HOME.askMaxDays.
 */
export const askPeriod = (question: string, now: number): AskPeriod => {
  const q = question.toLowerCase().replace(/\s+/g, " ")
  const floor = now - HOME.askMaxDays * DAY_MS
  const clamp = (p: AskPeriod): AskPeriod => ({ from: Math.max(floor, p.from), to: p.to })
  for (const pattern of COUNTED) {
    const m = q.match(pattern)
    const p = m && rolling(m[1], m[2] ?? "", now)
    if (p) return clamp(p)
  }
  for (const [pattern, period] of CALENDAR) if (pattern.test(q)) return clamp(period(now))
  const m = q.match(UNCOUNTED)
  const p = m && rolling(undefined, m[1] ?? "", now)
  return p ? clamp(p) : { from: now - HOME.askDays * DAY_MS, to: null }
}
