const CVE_ID = /^cve-\d{4}-\d{4,}$/i

/** Punctuation at either end of a name or word: quotes, brackets, commas, full stops. */
const EDGE_PUNCT = /^\p{P}+|\p{P}+$/gu

/**
 * Lookup key for an entity name: CVE IDs upper-cased as they are; otherwise accents stripped, lower case, single
 * spaces, end punctuation trimmed and trailing corporate `suffixes` dropped as whole words ("Nokia Oyj" and
 * "nokia" share a key). "" for anything under 2 characters, which callers skip.
 */
export const normaliseEntityKey = (name: string, suffixes: readonly string[]) => {
  const trimmed = name.trim()
  if (CVE_ID.test(trimmed)) return trimmed.toUpperCase()
  const words = trimmed
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(EDGE_PUNCT, ""))
    .filter(Boolean)
  while (words.length > 1 && suffixes.includes(words.at(-1) ?? "")) words.pop()
  const key = words.join(" ")
  return key.length < 2 ? "" : key
}
