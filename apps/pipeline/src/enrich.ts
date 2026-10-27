import { FETCH } from "@digest/core"

type EpssResponse = { data?: { cve: string; epss: string }[] }

/** EPSS scores from FIRST; missing CVEs are simply absent. */
export const fetchEpss = async (cveIds: string[]): Promise<Map<string, number>> => {
  const out = new Map<string, number>()
  if (cveIds.length === 0) return out
  try {
    const res = await fetch(`https://api.first.org/data/v1/epss?cve=${encodeURIComponent(cveIds.join(","))}`, {
      headers: { "user-agent": FETCH.userAgent, accept: "application/json" },
      signal: AbortSignal.timeout(FETCH.timeoutMs),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return out
    }
    const body = (await res.json()) as EpssResponse
    for (const d of body.data ?? []) {
      const v = Number(d.epss)
      if (Number.isFinite(v)) out.set(d.cve.toUpperCase(), v)
    }
  } catch (e) {
    console.log(JSON.stringify({ event: "epss_failed", error: String(e) }))
  }
  return out
}
