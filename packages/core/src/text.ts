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
