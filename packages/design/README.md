# @digest/design

Design tokens for the dashboard. `tokens.json` is the source; `pnpm --filter @digest/design build` writes `tokens.css`, which the app imports after Tailwind. Never edit `tokens.css` by hand.

- Tokens become Tailwind theme keys: `--color-<name>` (`bg-surface`, `text-ink-muted`), `--radius-*`, `--shadow-*` (`shadow-glow-amber`, `shadow-focus-ring`), `--text-<style>` (`text-label`), `--font-sans`, `--font-mono`, `--size-control-sm`, `-md` and `-lg` (`h-(--size-control-md)`). Stream colours are also plain `--stream-1` to `--stream-8` and `--stream-other` for SVG.
- Type classes: `.dd-display` to `.dd-body-sm` for reading, `.dd-readout-xl`, `.dd-readout`, `.dd-data`, `.dd-label`, `.dd-tick` for anything measured. Plus `.dd-sr-only` and `.dd-focus`.
- No glyph separators in anything a reader sees: no bullet, en dash, em dash, middot or pipe. Use flex gaps, `dl`, `time` and lists.
- Negative numbers use the minus sign U+2212, never a hyphen. Times are UTC with a Z suffix.
- Light theme only.
