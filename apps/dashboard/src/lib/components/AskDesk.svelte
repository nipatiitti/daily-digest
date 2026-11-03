<script lang="ts">
import { HOME, sanitizeUserText } from "@digest/core"
import Button from "./Button.svelte"

/** Answer text cut at its THR-12 and EVT-345 ids, padded or not, each id with the page it links to. */
const refSegments = (text: string) => {
  // split puts each id's two captures, kind and number, after the text before it: text, kind, number, text, ...
  const parts = sanitizeUserText(text).split(/\b(THR|EVT)-0*(\d+)\b/)
  const out: { text: string; href: string | null }[] = []
  for (let i = 0; i < parts.length; i += 3) {
    out.push({ text: parts[i] ?? "", href: null })
    const kind = parts[i + 1]
    const id = parts[i + 2]
    if (kind) out.push({ text: `${kind}-${id}`, href: `/${kind === "THR" ? "threads" : "events"}/${id}` })
  }
  return out
}

let question = $state("")
let text = $state("")
let error = $state<string | null>(null)
let cached = $state(false)
let running = $state(false)

/** The stored answer comes back at once, a new one streams in as Claude writes it. */
const ask = async (submit: SubmitEvent) => {
  submit.preventDefault()
  if (!question.trim()) return
  running = true
  text = ""
  error = null
  cached = false
  try {
    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    })
    if (!res.ok || !res.body) {
      error = (await res.text()) || `The answer failed with status ${res.status}.`
      return
    }
    cached = res.headers.get("x-answer-cached") === "1"
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    running = false
  }
}
</script>

<div class="grid gap-3">
  <form class="flex flex-wrap items-center gap-3" onsubmit={ask}>
    <label
      class="flex h-(--size-control-lg) min-w-0 flex-1 basis-64 items-center rounded-full border border-line-control bg-surface px-5 focus-within:border-focus focus-within:shadow-focus-ring"
    >
      <span class="dd-sr-only">Your question</span>
      <input
        type="text"
        bind:value={question}
        maxlength={HOME.questionMaxChars}
        placeholder="What moved in the peace talks this week?"
        class="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-subtle"
      />
    </label>
    <Button type="submit" disabled={running || !question.trim()}>Ask</Button>
    {#if cached}
      <span class="dd-label rounded-full border border-line px-2 text-ink-muted">Cached</span>
    {/if}
  </form>
  <div aria-live="polite" class="max-w-prose">
    {#if error}
      <p class="dd-body-sm text-sev-high">{error}</p>
    {:else if text}
      <!-- Svelte trims the whitespace around each block's content, so ids and text join as written. -->
      <p class="dd-body text-pretty">
        {#each refSegments(text) as s, i (i)}
          {#if s.href}
            <a href={s.href} class="font-mono hover:underline">{s.text}</a>
          {:else}
            {s.text}
          {/if}
        {/each}
      </p>
    {/if}
  </div>
</div>
