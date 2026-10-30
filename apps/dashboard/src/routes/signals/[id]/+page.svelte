<script lang="ts">
import { TrendChart } from "#lib/charts/index.ts"
import { pairId } from "#lib/components/AskButton.svelte"
import { AskButton, Button, Delta, EntityChip, fmtInt, fmtTime, padId, StoryCard } from "#lib/components/index.ts"
import { page } from "$app/state"
import { closeForm, detachForm, mergeForm, renameForm, signalPage } from "./signal.remote.ts"

const p = $derived(await signalPage(Number(page.params.id)))
const t = $derived(p.theme)
/** The signal to compare this one with. */
let other = $state<number | null>(null)
const sig = (id: number) => `/signals/${id}`
const sty = (id: number) => `/stories/${id}`
const input = "h-(--size-control-sm) w-48 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"

/** Statuses and event kinds as the page says them. */
const WORDS: Record<string, string> = {
  provisional: "Provisional",
  active: "Active",
  closed: "Closed",
  merged: "Merged",
  created: "Created",
  renamed: "Renamed",
  reopened: "Reopened",
  promoted: "Promoted",
  assigned: "Story joined",
  detached: "Story detached",
}
/** Event detail keys as words. */
const KEYS: Record<string, string> = {
  storyId: "Story",
  into: "Into",
  from: "From",
  to: "To",
  by: "By",
  confidence: "Confidence",
  linkedBy: "Linked by",
}
/** An event's detail as words, story and signal IDs as links. */
const detailParts = (detail: Record<string, unknown> | null) =>
  Object.entries(detail ?? {}).map(([k, v]) => {
    const link =
      typeof v !== "number"
        ? null
        : k === "storyId"
          ? { href: sty(v), label: padId("STY", v) }
          : k === "into" || k === "from"
            ? { href: sig(v), label: padId("SIG", v) }
            : null
    const text = typeof v === "string" ? (WORDS[v] ?? v) : typeof v === "object" ? JSON.stringify(v) : String(v)
    return { label: KEYS[k] ?? k, text, link }
  })

/** An enhance callback that submits only after the browser's confirm dialog. */
const confirmed = (question: string) => async (f: { submit: () => Promise<unknown> }) => {
  if (confirm(question)) await f.submit()
}
</script>

<svelte:head>
  <title>{padId("SIG", t.id)} {t.name}</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
  {#each list ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
{/snippet}

<div class="grid gap-10 pt-8">
  <header class="grid gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <a href={sig(t.id)} class="dd-tick">{padId("SIG", t.id)}</a>
      <span class="dd-label">{WORDS[t.status]}</span>
      <Delta pct={t.momentum24h} suffix="24h" />
      <Delta pct={t.momentum7d} suffix="7d" />
    </div>
    <h1 class="dd-display">{t.name}</h1>
    <p class="dd-body">{t.description}</p>
    {#if t.explanation}
      <p class="dd-body text-ink-muted">
        {t.explanation}
        {#if t.explainedAt}<span class="dd-tick">{fmtTime(t.explainedAt)}</span>{/if}
      </p>
    {/if}
    <p class="dd-body-sm text-ink-muted">
      {fmtInt(t.storyCount)}
      {t.storyCount === 1 ? "story" : "stories"}, first seen {fmtTime(t.firstSeen)}, last story {fmtTime(t.lastSeen)}.
    </p>
    {#if p.entities.length}
      <div class="flex flex-wrap gap-3">
        {#each p.entities as e (e.key)}
          <EntityChip entityKey={e.key} name={e.name} kind={e.kind} pct={e.momentum24h} />
        {/each}
      </div>
    {/if}
  </header>

  <section class="grid gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">{p.spine.title}</h2>
    <TrendChart
      labels={p.spine.labels}
      series={[{ name: "Articles", stream: "other", values: p.spine.values }]}
      title={p.spine.title}
    />
    {#if p.joins.length}
      <h3 class="dd-label">Stories joining</h3>
      <!-- Inset by TrendChart's plot margins for one labelled series, so each mark sits over its bucket. -->
      <ol class="relative mr-26 ml-11 h-4">
        {#each p.joins as j (j.storyId)}
          {@const label = `${padId("STY", j.storyId)} ${j.title}, joined ${fmtTime(j.at)}`}
          <li class="absolute top-0 -translate-x-1/2" style:left="{j.x * 100}%">
            <a
              href={sty(j.storyId)}
              title={label}
              class="block h-4 w-1 rounded-full bg-amber outline-none hover:bg-ink focus-visible:shadow-focus-ring"
            >
              <span class="dd-sr-only">{label}</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label">Stories</h2>
    {#if p.stories.length}
      <div class="grid gap-6 md:grid-cols-3">
        {#each p.stories as s (s.id)}
          <StoryCard
            id={s.id}
            stream={s.category}
            score={s.score}
            updatedAt={s.lastArticleAt}
            title={s.title}
            summary={s.summary ?? "Not evaluated yet."}
            stats={[
              { name: "Articles", value: s.articles },
              { name: "Sources", value: s.sources },
              { name: "Origins", value: s.origins },
            ]}
          >
            {#snippet momentum()}<Delta pct={s.momentum24h} suffix="24h" />{/snippet}
          </StoryCard>
        {/each}
      </div>
    {:else}
      <p class="dd-body text-ink-muted">No stories linked.</p>
    {/if}
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label">Ask Claude</h2>
    {#key t.id}
      <AskButton purpose="review" subjectKind="theme" subjectId={t.id} label="Month in review" />
      <AskButton purpose="compare" subjectKind="theme" subjectId={pairId(t.id, other)} label="Compare">
        <label class="dd-label">
          With signal ID <input type="number" min="1" bind:value={other} class={input} />
        </label>
      </AskButton>
    {/key}
  </section>

  <section class="grid gap-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">Actions</h2>
    <div class="flex flex-wrap items-start gap-8">
      <form {...renameForm} class="grid gap-2">
        <input {...renameForm.fields.id.as("hidden", t.id)} />
        <div class="flex items-center gap-2">
          <label class="dd-label">Name <input {...renameForm.fields.name.as("text")} class={input} /></label>
          <Button type="submit">Rename</Button>
        </div>
        {@render issues(renameForm.fields.allIssues())}
      </form>
      <form
        {...mergeForm.enhance(confirmed(`Merge ${t.name} into the signal you named? Its stories link there.`))}
        class="grid gap-2"
      >
        <input {...mergeForm.fields.id.as("hidden", t.id)} />
        <div class="flex items-center gap-2">
          <label class="dd-label">
            Into signal ID <input {...mergeForm.fields.into.as("number")} min="1" class={input} />
          </label>
          <Button type="submit">Merge</Button>
        </div>
        {@render issues(mergeForm.fields.allIssues())}
      </form>
      <form {...detachForm.enhance(confirmed("Detach the story you named from this signal?"))} class="grid gap-2">
        <input {...detachForm.fields.id.as("hidden", t.id)} />
        <div class="flex items-center gap-2">
          <label class="dd-label">
            Story ID <input {...detachForm.fields.story.as("number")} min="1" class={input} />
          </label>
          <Button type="submit">Detach</Button>
        </div>
        {@render issues(detachForm.fields.allIssues())}
      </form>
      <form {...closeForm.enhance(confirmed("Close this signal? A story joining reopens it."))} class="grid gap-2">
        <input {...closeForm.fields.id.as("hidden", t.id)} />
        <Button type="submit" disabled={t.status === "closed"}>Close signal</Button>
        {@render issues(closeForm.fields.allIssues())}
      </form>
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">History</h2>
    {#if p.events.length}
      <ul class="grid divide-y divide-line">
        {#each p.events as ev (ev.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(ev.at)}</span>
            <span class="font-semibold">{WORDS[ev.kind] ?? ev.kind}</span>
            {#each detailParts(ev.detailJson) as part (part.label)}
              <span class="text-ink-muted">
                {part.label}
                {#if part.link}<a href={part.link.href} class="dd-tick">{part.link.label}</a>{:else}{part.text}{/if}
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dd-body text-ink-muted">No events yet.</p>
    {/if}
  </section>
</div>
