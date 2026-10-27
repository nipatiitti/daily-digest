import { EVAL, FETCH } from "@digest/core"

/** Page text as markdown via Workers AI toMarkdown; null when the fetch or conversion fails. */
export const fetchFulltext = async (ai: Ai, url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": FETCH.userAgent, accept: "text/html, application/xhtml+xml" },
      signal: AbortSignal.timeout(EVAL.fetchTimeoutMs),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    const html = await res.text()
    const out = await ai.toMarkdown({ name: "article.html", blob: new Blob([html], { type: "text/html" }) })
    if (out.format === "error") return null
    const text = out.data.replace(/\n{3,}/g, "\n\n").trim()
    return text.length > EVAL.fulltextMaxChars ? text.slice(0, EVAL.fulltextMaxChars) : text || null
  } catch (e) {
    console.log(JSON.stringify({ event: "fulltext_failed", url, error: String(e) }))
    return null
  }
}
