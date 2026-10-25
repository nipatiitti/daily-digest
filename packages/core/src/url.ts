const TRACKING_PARAM =
  /^(utm_|mc_|mtm_|pk_|fbclid$|gclid$|dclid$|msclkid$|igshid$|ref$|ref_src$|cmpid$|ocid$|sr_share$)/i

/** Normalised URL used for dedupe: http(s) only, no fragment, no tracking params, sorted query. */
export const canonicalUrl = (raw: string, base?: string): string | null => {
  let url: URL
  try {
    url = new URL(raw.trim(), base)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  }
  url.searchParams.sort()
  return url.toString()
}

export const domainOf = (url: string) => new URL(url).hostname.replace(/^www\./, "")
