/** Input for the embedding model: title and lead, capped. Never the LLM summary. */
export const embeddingText = (title: string, snippet: string | null, maxChars: number) => {
  const text = snippet ? `${title}\n${snippet}` : title
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

/**
 * User-facing text never contains en or em dashes or bullets (AGENTS.md). Applied to
 * everything a model writes before it is rendered.
 */
export const sanitizeUserText = (s: string) =>
  s
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/^\s*•\s*/gm, "")
    .replace(/•/g, "")
    .replace(/, ,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
