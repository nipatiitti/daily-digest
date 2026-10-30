<script lang="ts">
import { DASHBOARD } from "@digest/core"
import { AskButton } from "#lib/components/index.ts"

let question = $state("")
</script>

<svelte:head>
  <title>Ask the desk</title>
</svelte:head>

<div class="grid gap-6 pt-8">
  <header class="grid max-w-prose gap-2">
    <h1 class="dd-display">Ask the desk</h1>
    <p class="dd-body text-ink-muted">
      Claude answers from the latest brief and the stories, facts and signals a search finds for your question. The
      same question on unchanged data comes back from the cache.
    </p>
  </header>
  <AskButton purpose="ask" subjectKind="cell" subjectId="desk" {question} label="Ask">
    <label
      class="flex h-(--size-control-lg) min-w-0 flex-1 basis-64 items-center rounded-full border border-line-control bg-surface px-5 focus-within:border-focus focus-within:shadow-focus-ring"
    >
      <span class="dd-sr-only">Your question</span>
      <input
        type="text"
        bind:value={question}
        maxlength={DASHBOARD.questionMaxChars}
        placeholder="What changed in the ransomware stories this week?"
        class="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-subtle"
      />
    </label>
  </AskButton>
</div>
