// Writes tokens.css from tokens.json. Run with `node build-tokens.ts`; the output is deterministic.
import { readFileSync, writeFileSync } from "node:fs"

type Token = { name: string; value: string }
type Style = { name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string }
type Tokens = {
  color: { tokens: Token[] }
  type: {
    fonts: { family: string; file: string; weight: string; style: string }[]
    families: Record<"sans" | "mono", string>
    groups: { family: "sans" | "mono"; styles: Style[] }[]
  }
  radius: { tokens: Token[] }
  shadow: { tokens: Token[] }
  size: { tokens: Token[] }
}

const tokens: Tokens = JSON.parse(readFileSync(new URL("./tokens.json", import.meta.url), "utf8"))

const colors = new Map(tokens.color.tokens.map((t) => [t.name, t.value]))
const resolve = (value: string): string => {
  const ref = /^\{(.+)\}$/.exec(value)?.[1]
  if (!ref) return value
  const target = colors.get(ref)
  if (!target) throw new Error(`Unknown colour reference ${value}`)
  return resolve(target)
}

const block = (selector: string, decls: string[], pad = "") =>
  [`${pad}${selector} {`, ...decls.map((d) => `${pad}  ${d};`), `${pad}}`].join("\n")
const layer = (name: string, blocks: string[]) => `@layer ${name} {\n${blocks.join("\n\n")}\n}`

/** Extra declarations for type styles that carry a colour or case of their own. */
const extras: Record<string, string[]> = {
  label: ["text-transform: uppercase", "color: var(--color-ink-subtle)"],
  tick: ["color: var(--color-ink-subtle)"],
}

const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => ({ family: g.family, s })))

const fonts = tokens.type.fonts.map((f) =>
  block("@font-face", [
    `font-family: "${f.family}"`,
    `font-style: ${f.style}`,
    `font-weight: ${f.weight}`,
    "font-display: swap",
    `src: url("./${f.file}") format("woff2")`,
  ]),
)

const theme = block("@theme static", [
  ...tokens.color.tokens.map((t) => `--color-${t.name}: ${resolve(t.value)}`),
  `--font-sans: ${tokens.type.families.sans}`,
  `--font-mono: ${tokens.type.families.mono}`,
  `--font-mono--font-feature-settings: "tnum"`,
  ...tokens.radius.tokens.map((t) => `--${t.name}: ${t.value}`),
  ...tokens.shadow.tokens.map((t) => `--${t.name.startsWith("shadow-") ? t.name : `shadow-${t.name}`}: ${t.value}`),
  ...styles.flatMap(({ s }) => [
    `--text-${s.name}: ${s.fontSize}`,
    `--text-${s.name}--line-height: ${s.lineHeight}`,
    `--text-${s.name}--font-weight: ${s.fontWeight}`,
    ...(s.letterSpacing ? [`--text-${s.name}--letter-spacing: ${s.letterSpacing}`] : []),
  ]),
  ...tokens.size.tokens.map((t) => `--size-${t.name}: ${t.value}`),
])

const streams = block(":root", [
  ...tokens.color.tokens.filter((t) => t.name.startsWith("stream-")).map((t) => `--${t.name}: var(--color-${t.name})`),
  "--stream-other: var(--color-ink-subtle)",
])

const base = layer("base", [
  block("body", ["background: var(--color-paper)", "color: var(--color-ink)", "font-family: var(--font-sans)"], "  "),
  block("::selection", ["background: var(--color-selection)", "color: var(--color-ink)"], "  "),
])

const components = layer("components", [
  ...styles.map(({ family, s }) =>
    block(
      `.dd-${s.name}`,
      [
        `font-family: var(--font-${family})`,
        `font-size: var(--text-${s.name})`,
        `line-height: var(--text-${s.name}--line-height)`,
        `font-weight: var(--text-${s.name}--font-weight)`,
        ...(s.letterSpacing ? [`letter-spacing: var(--text-${s.name}--letter-spacing)`] : []),
        ...(family === "mono" ? ["font-variant-numeric: tabular-nums"] : []),
        ...(extras[s.name] ?? []),
      ],
      "  ",
    ),
  ),
  block(
    ".dd-sr-only",
    [
      "position: absolute",
      "width: 1px",
      "height: 1px",
      "padding: 0",
      "margin: -1px",
      "overflow: hidden",
      "clip: rect(0 0 0 0)",
      "white-space: nowrap",
      "border: 0",
    ],
    "  ",
  ),
  block(".dd-focus:focus-visible", ["outline: none", "box-shadow: var(--shadow-focus-ring)"], "  "),
])

const header = "/* Generated from tokens.json by build-tokens.ts. Do not edit by hand. */"
const css = `${[header, ...fonts, theme, streams, base, components].join("\n\n")}\n`
writeFileSync(new URL("./tokens.css", import.meta.url), css)
