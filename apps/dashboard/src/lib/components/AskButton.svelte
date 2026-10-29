<script lang="ts">
import type { ActionSubject, LlmPurpose } from "@digest/db"
import Button from "./Button.svelte"
import { idSegments } from "./format.ts"

type Props = {
  purpose: LlmPurpose
  subjectKind: ActionSubject
  subjectId: string | number
  /** A verb in sentence case, such as "Explain the score". */
  label: string
}

let { purpose, subjectKind, subjectId, label }: Props = $props()

let text = $state("")
let error = $state<string | null>(null)
let cached = $state(false)
let running = $state(false)

/** Asks only on click: the stored answer comes back at once, a new one streams in as Claude writes it. */
const ask = async () => {
  running = true
  text = ""
  error = null
  cached = false
  try {
    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose, subjectKind, subjectId: String(subjectId) }),
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
  <div class="flex flex-wrap items-center gap-3">
    <Button size="sm" disabled={running} onclick={ask}>{label}</Button>
    {#if cached}
      <span class="dd-label rounded-full border border-line px-2 text-ink-muted">Cached</span>
    {/if}
  </div>
  <div aria-live="polite" class="max-w-prose">
    {#if error}
      <p class="dd-body-sm text-sev-high">{error}</p>
    {:else if text}
      <!-- Svelte trims the whitespace around each block's content, so ids and text join as written. -->
      <p class="dd-body text-pretty">
        {#each idSegments(text) as s, i (i)}
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
