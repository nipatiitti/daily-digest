<script lang="ts">
import { Button, fmtTime, padId } from "#lib/components/index.ts"
import { page } from "$app/state"
import { articlePage, moveForm, newStoryForm } from "./article.remote.ts"

const p = $derived(await articlePage(Number(page.params.id)))
const a = $derived(p.article)
const sty = (id: number) => `/stories/${id}`
const art = (id: number) => `/articles/${id}`

/** Placement methods and action kinds as the page says them. */
const WORDS: Record<string, string> = {
  new: "New story",
  join: "Joined",
  copy: "Copy of an origin",
  cve: "Same CVE",
  "ask-yes": "Asked, same event",
  "ask-no": "Asked, different event",
  "join-fallback": "Joined without asking",
  "new-fallback": "New story without asking",
  move_article: "Move article",
  new_story: "New story",
  edit: "Cell edit",
}
const word = (k: string) => WORDS[k] ?? k

/** Audit detail keys as words; the linked ones hold story or article IDs. */
const KEYS: Record<string, string> = {
  into: "Into",
  from: "From",
  storyId: "Story",
  articleId: "Article",
  closedFrom: "Closed the story it left",
}
const LINKED: Record<string, { prefix: string; href: (id: number) => string }> = {
  into: { prefix: "STY", href: sty },
  from: { prefix: "STY", href: sty },
  storyId: { prefix: "STY", href: sty },
  articleId: { prefix: "ART", href: art },
}
const words = (key: string, v: unknown): string => {
  if (v === null || v === undefined) return "none"
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") return key.endsWith("At") ? fmtTime(v) : String(v)
  if (typeof v === "string") return word(v)
  return JSON.stringify(v)
}
/** An audit row's detail as words, story and article IDs as links. */
const detailParts = (detail: Record<string, unknown> | null) =>
  Object.entries(detail ?? {}).map(([k, v]) => {
    const link = LINKED[k]
    const links = link && typeof v === "number" ? [{ href: link.href(v), label: padId(link.prefix, v) }] : []
    return { label: KEYS[k] ?? k, text: links.length ? "" : words(k, v), links }
  })
const input = "h-(--size-control-sm) w-28 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"

/** An enhance callback that submits only after the browser's confirm dialog. */
const confirmed = (question: string) => async (f: { submit: () => Promise<unknown> }) => {
  if (confirm(question)) await f.submit()
}
</script>

<svelte:head>
  <title>{padId("ART", a.id)} {a.title}</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
  {#each list ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
{/snippet}

<div class="grid gap-10 pt-8">
  <header class="grid gap-4">
    <a href="/articles/{a.id}" class="dd-tick">{padId("ART", a.id)}</a>
    <h1 class="dd-display">{a.title}</h1>
    {#if a.snippet}<p class="dd-body">{a.snippet}</p>{/if}
    <a href={a.canonicalUrl} class="dd-body-sm break-all text-ink-muted hover:underline">{a.canonicalUrl}</a>
  </header>

  <dl class="grid gap-x-8 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
    <dt class="dd-label">Source</dt>
    <dd class="dd-body-sm"><a href="/data/sources/{a.sourceId}">{a.sourceName}</a>, tier {a.tier}</dd>
    <dt class="dd-label">Published</dt>
    <dd class="dd-body-sm">{fmtTime(a.publishedAt)}, fetched {fmtTime(a.fetchedAt)}</dd>
    <dt class="dd-label">Origin</dt>
    <dd class="dd-body-sm">
      {#if a.originId === null}
        This article is the origin
      {:else}
        Copy of <a href={art(a.originId)}>{padId("ART", a.originId)}</a>
      {/if}
    </dd>
    <dt class="dd-label">Embedding</dt>
    <dd class="dd-body-sm">{a.embeddedAt === null ? "Not embedded yet" : `Embedded ${fmtTime(a.embeddedAt)}`}</dd>
    <dt class="dd-label">Story</dt>
    <dd class="dd-body-sm">
      {#if a.storyId === null}
        Not in a story
      {:else}
        <a href={sty(a.storyId)}>{padId("STY", a.storyId)}</a> {a.storyTitle}
      {/if}
    </dd>
    {#if a.injectionSuspect}
      <dt class="dd-label">Injection</dt>
      <dd class="dd-body-sm text-sev-high">Flagged as a possible prompt injection at evaluation</dd>
    {/if}
    <dt class="dd-label">Full text</dt>
    <dd class="dd-body-sm text-ink-muted">Fetched at evaluation time and not stored.</dd>
  </dl>

  <section class="grid gap-4">
    <h2 class="dd-label">Placements</h2>
    {#if p.matches.length}
      <ul class="grid divide-y divide-line">
        {#each p.matches as m (m.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(m.at)}</span>
            <span class="font-semibold">{word(m.how)}</span>
            {#if m.cosine !== null}<span>Cosine {m.cosine.toFixed(2)}</span>{/if}
            {#if m.storyId !== null}<span>Into <a href={sty(m.storyId)}>{padId("STY", m.storyId)}</a></span>{/if}
            {#if m.candidateStoryId !== null}
              <span class="text-ink-muted">
                Best candidate <a href={sty(m.candidateStoryId)}>{padId("STY", m.candidateStoryId)}</a>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dd-body text-ink-muted">No placement logged.</p>
    {/if}
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Audit</h2>
    {#if a.audit.length}
      <ul class="grid divide-y divide-line">
        {#each a.audit as act (act.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(act.at)}</span>
            <span class="font-semibold">{word(act.kind)}</span>
            <span>{act.by}</span>
            {#each detailParts(act.detailJson) as part (part.label)}
              <span class="text-ink-muted">
                {part.label}
                {part.text}
                {#each part.links as l (l.href)}<a href={l.href} class="dd-tick">{l.label}</a>{/each}
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dd-body text-ink-muted">No dashboard actions on this article.</p>
    {/if}
  </section>

  <section class="grid gap-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">Actions</h2>
    <div class="flex flex-wrap items-start gap-8">
      <form {...moveForm} class="grid gap-2">
        <input {...moveForm.fields.id.as("hidden", a.id)} />
        <div class="flex items-center gap-2">
          <label class="dd-label">
            To story ID <input {...moveForm.fields.into.as("number")} min="1" class={input} />
          </label>
          <Button type="submit">Move</Button>
        </div>
        {@render issues(moveForm.fields.allIssues())}
      </form>
      <form {...newStoryForm.enhance(confirmed("Start a new story from this article?"))} class="grid gap-2">
        <input {...newStoryForm.fields.id.as("hidden", a.id)} />
        <Button type="submit">Start a new story</Button>
        {@render issues(newStoryForm.fields.allIssues())}
      </form>
    </div>
  </section>
</div>
