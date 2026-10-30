<script lang="ts">
import { TrendChart } from "#lib/charts/index.ts"
import { AskButton, Button, Delta, entityHref, fmtInt, fmtTime, StoryCard } from "#lib/components/index.ts"
import { page } from "$app/state"
import { entityPage, mergeForm, renameForm } from "./entity.remote.ts"

const p = $derived(await entityPage(page.params.key ?? ""))
const e = $derived(p.entity)
const input = "h-(--size-control-sm) w-48 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"

/** An enhance callback that submits only after the browser's confirm dialog. */
const confirmed = (question: string) => async (f: { submit: () => Promise<unknown> }) => {
  if (confirm(question)) await f.submit()
}
</script>

<svelte:head>
  <title>{e.name}</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
  {#each list ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
{/snippet}

<div class="grid gap-10 pt-8">
  <header class="grid gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <a href={entityHref(e.key)} class="dd-tick">{e.key}</a>
      <span class="dd-label">{e.kind}</span>
      <Delta pct={e.momentum24h} suffix="24h" />
      <Delta pct={e.momentum7d} suffix="7d" />
    </div>
    <h1 class="dd-display">{e.name}</h1>
    <p class="dd-body-sm text-ink-muted">
      {fmtInt(e.storyCount)}
      {e.storyCount === 1 ? "story" : "stories"}, first seen {fmtTime(e.firstSeen)}, last seen {fmtTime(e.lastSeen)}.
    </p>
    {#if p.aliases.length}
      <p class="dd-body-sm flex flex-wrap gap-x-3 text-ink-muted">
        Aliases
        {#each p.aliases as a (a.id)}
          <span title={a.key}>{a.name}</span>
        {/each}
      </p>
    {/if}
  </header>

  <section class="grid gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">Articles per hour</h2>
    <TrendChart
      labels={p.articlesPerHour.labels}
      series={[{ name: "Articles", stream: "other", values: p.articlesPerHour.values }]}
      title="Articles per hour"
    />
    <h2 class="dd-label">New stories per day</h2>
    <TrendChart
      labels={p.storiesPerDay.labels}
      series={[{ name: "Stories", stream: "other", values: p.storiesPerDay.values }]}
      title="New stories per day"
    />
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
            themes={s.themes}
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
    {#key e.id}
      <AskButton purpose="review" subjectKind="entity" subjectId={e.id} label="Month in review" />
    {/key}
  </section>

  <section class="grid gap-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">Actions</h2>
    <div class="flex flex-wrap items-start gap-8">
      <form {...renameForm} class="grid gap-2">
        <input {...renameForm.fields.id.as("hidden", e.id)} />
        <input {...renameForm.fields.key.as("hidden", e.key)} />
        <div class="flex items-center gap-2">
          <label class="dd-label">Name <input {...renameForm.fields.name.as("text")} class={input} /></label>
          <Button type="submit">Rename</Button>
        </div>
        {@render issues(renameForm.fields.allIssues())}
      </form>
      <form
        {...mergeForm.enhance(confirmed(`Merge the entity you named into ${e.name}? Its stories link here.`))}
        class="grid gap-2"
      >
        <input {...mergeForm.fields.id.as("hidden", e.id)} />
        <input {...mergeForm.fields.key.as("hidden", e.key)} />
        <div class="flex items-center gap-2">
          <label class="dd-label">Alias key <input {...mergeForm.fields.alias.as("text")} class={input} /></label>
          <Button type="submit">Merge in</Button>
        </div>
        {@render issues(mergeForm.fields.allIssues())}
      </form>
    </div>
  </section>
</div>
