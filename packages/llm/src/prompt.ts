/** Feed or model text put inside a prompt tag, escaped so it cannot close the tag and leave the data. */
export const tagText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Text put in a prompt tag's attribute value, escaped so it cannot close the quotes either. */
export const attrText = (s: string) => tagText(s).replace(/"/g, "&quot;")

/** A Unix ms time as prompts show it, such as 2026-11-03 06:00 UTC. */
export const promptTime = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`

/** The glyph rule every prompt that writes user-facing text carries (AGENTS.md). */
export const PLAIN = "Never use the en dash, the em dash, bullets, middots or pipes. Use commas and full stops."
