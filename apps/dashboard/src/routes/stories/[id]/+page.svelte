<script lang="ts">
import { BarChart, TrendChart } from "#lib/charts/index.ts"
import { pairId } from "#lib/components/AskButton.svelte"
import {
  AskButton,
  Button,
  Delta,
  EntityChip,
  FactRow,
  fmtDate,
  fmtInt,
  fmtTime,
  padId,
  SeverityBadge,
  SignalChip,
  StreamTag,
  streamSlot,
} from "#lib/components/index.ts"
import SendNowButton from "#lib/components/SendNowButton.svelte"
import { page } from "$app/state"
import { closeForm, factStatusForm, followForm, mergeForm, requeueForm, storyPage } from "./story.remote.ts"

const p = $derived(await storyPage(Number(page.params.id)))
const s = $derived(p.story)
/** The story to compare this one with. */
let other = $state<number | null>(null)
const stream = $derived(streamSlot(s.category))

/** Statuses, gates, delivery and signal kinds, action kinds and placement methods as the page says them. */
const WORDS: Record<string, string> = {
  active: "Active",
  closed: "Closed",
  merged: "Merged",
  superseded: "Superseded",
  contradicted: "Contradicted",
  evidence: "Evidence",
  alert: "Alert",
  update: "Update",
  digest: "Digest",
  follow: "Follow",
  hn: "Hacker News",
  bsky: "Bluesky",
  gtrends: "Google Trends",
  mastodon: "Mastodon",
  sans: "SANS",
  kagi: "Kagi",
  close: "Close",
  merge: "Merge",
  fact_status: "Fact status",
  requeue: "Evaluate again",
  move_article: "Move article",
  new_story: "New story",
  edit: "Cell edit",
  new: "New story",
  join: "Joined",
  copy: "Copy of an origin",
  cve: "Same CVE",
  "ask-yes": "Asked, same event",
  "ask-no": "Asked, different event",
  "join-fallback": "Joined without asking",
  "new-fallback": "New story without asking",
}
const word = (k: string) => WORDS[k] ?? k
const sty = (id: number) => `/stories/${id}`
const art = (id: number) => `/articles/${id}`

/** Audit detail keys as words; the linked ones hold story or article IDs. */
const KEYS: Record<string, string> = {
  into: "Into",
  from: "From",
  to: "To",
  storyId: "Story",
  articleId: "Article",
  articleIds: "Articles",
  expiresAt: "Until",
  followedAt: "Followed",
  lastReportedFactAt: "Last reported fact",
  previous: "Before",
  fromStatus: "Status before",
  intoHash: "Target hash",
  hash: "Hash",
  closedFrom: "Closed the story it left",
}
const LINKED: Record<string, { prefix: string; href: (id: number) => string }> = {
  into: { prefix: "STY", href: sty },
  from: { prefix: "STY", href: sty },
  storyId: { prefix: "STY", href: sty },
  articleId: { prefix: "ART", href: art },
  articleIds: { prefix: "ART", href: art },
}
const words = (key: string, v: unknown): string => {
  if (v === null || v === undefined) return "none"
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") return key.endsWith("At") ? fmtTime(v) : String(v)
  if (typeof v === "string") return word(v)
  if (Array.isArray(v)) return v.map((x) => words(key, x)).join(", ") || "none"
  return Object.entries(v)
    .map(([k, x]) => `${KEYS[k] ?? k} ${words(k, x)}`)
    .join(", ")
}
/** An audit row's detail as words, story and article IDs as links. */
const detailParts = (detail: Record<string, unknown> | null) =>
  Object.entries(detail ?? {}).map(([k, v]) => {
    const link = LINKED[k]
    const ids = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "number")
    const links = link && ids.length ? ids.map((id) => ({ href: link.href(id), label: padId(link.prefix, id) })) : []
    return { label: KEYS[k] ?? k, text: links.length ? "" : words(k, v), links }
  })
const input = "h-(--size-control-sm) w-28 rounded-full border border-line-control bg-surface px-3 text-sm text-ink"

/** An enhance callback that submits only after the browser's confirm dialog. */
const confirmed = (question: string) => async (f: { submit: () => Promise<unknown> }) => {
  if (confirm(question)) await f.submit()
}

const stats = $derived([
  { name: "Articles", value: fmtInt(p.articleCount) },
  { name: "Independent origins", value: fmtInt(s.independentOrigins) },
  { name: "Domains", value: fmtInt(s.uniqueDomains) },
  { name: "Authoritative", value: fmtInt(s.authoritativeCount) },
  { name: "Origins, 6 hours", value: fmtInt(s.origins6h) },
  { name: "Finland relevance", value: `${s.fiRelevance} of 2` },
])

const terms = $derived.by(() => {
  const b = p.breakdown
  if (!b) return []
  const base = b.rubric * b.credibility * b.recency
  const caps = b.caps.map((c) => `${c.flag} at ${c.cap}, ${c.applied ? "applied" : "not reached"}`)
  return [
    { term: "Rubric value", value: `${b.rubric.toFixed(1)} of 100, ${b.uncapped.toFixed(1)} before caps` },
    { term: "Caps", value: caps.length ? caps.join("; ") : "No flags set" },
    { term: "Credibility factor", value: `${b.credibility}, best tier ${b.bestTier ?? "unknown"}` },
    {
      term: "Recency factor",
      value: `${b.recency.toFixed(3)} as of ${fmtTime(b.at)}, last article ${fmtTime(s.lastArticleAt)}`,
    },
    { term: "Base", value: `${b.rubric.toFixed(1)} × ${b.credibility} × ${b.recency.toFixed(3)} = ${base.toFixed(1)}` },
    { term: "Origin bonus", value: `${b.originBonus} for ${fmtInt(s.independentOrigins)} independent origins` },
    { term: "Velocity bonus", value: `${b.velocityBonus} for ${fmtInt(s.origins6h)} origins in 6 hours` },
    { term: "Score", value: `${b.score}, stored ${s.score ?? "none"}` },
    { term: "Tier", value: `${b.tier}, stored ${s.tier ?? "none"}` },
    { term: "Config version", value: String(b.configVersion) },
  ]
})
const noFacts = $derived(p.facts.every((g) => g.rows.length === 0))
</script>

<svelte:head>
  <title>{padId("STY", s.id)} {s.title}</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
  {#each list ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
{/snippet}

<div class="grid gap-10 pt-8">
  <header class="grid gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <a href={sty(s.id)} class="dd-tick">{padId("STY", s.id)}</a>
      <StreamTag stream={s.category} />
      <SeverityBadge score={s.score} />
      <Delta pct={s.momentum24h} suffix="24h" />
      <span class="dd-label">{WORDS[s.status]}</span>
    </div>
    <h1 class="dd-display">{s.title}</h1>
    {#if p.entities.length}
      <div class="flex flex-wrap gap-3">
        {#each p.entities as e (e.key)}
          <EntityChip entityKey={e.key} name={e.name} kind={e.kind} pct={e.momentum24h} />
        {/each}
      </div>
    {/if}
    {#if p.themes.length}
      <div class="flex flex-wrap gap-3">
        {#each p.themes as t (t.id)}
          <SignalChip id={t.id} name={t.name} pct={t.momentum24h} href="/signals/{t.id}" />
        {/each}
      </div>
    {/if}
    <p class="dd-body">{s.summary ?? "Not evaluated yet."}</p>
    {#if s.whyMatters}<p class="dd-body text-ink-muted">{s.whyMatters}</p>{/if}
    <p class="dd-body-sm text-ink-muted">
      First seen {fmtTime(s.firstSeen)}, last article {fmtTime(s.lastArticleAt)}.
      {#if s.mergedInto}Merged into <a href={sty(s.mergedInto)}>{padId("STY", s.mergedInto)}</a>.{/if}
      {#if s.previousStoryId}Continues <a href={sty(s.previousStoryId)}>{padId("STY", s.previousStoryId)}</a>.{/if}
      {#if p.follow?.active}Followed until {fmtTime(p.follow.expiresAt)}.{/if}
    </p>
    {#if p.mergedIn.length}
      <p class="dd-body-sm flex flex-wrap gap-x-3 text-ink-muted">
        Merged in
        {#each p.mergedIn as m (m.id)}
          <a href={sty(m.id)} title={m.title} class="dd-tick">{padId("STY", m.id)}</a>
        {/each}
      </p>
    {/if}
    <dl class="flex flex-wrap gap-x-10 gap-y-4">
      {#each stats as st (st.name)}
        <div class="grid gap-1">
          <dt class="dd-label">{st.name}</dt>
          <dd class="dd-data">{st.value}</dd>
        </div>
      {/each}
    </dl>
  </header>

  <section class="grid gap-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 class="dd-label">Articles per hour</h2>
    <TrendChart
      labels={p.articlesPerHour.labels}
      series={[{ name: "Articles", stream, values: p.articlesPerHour.values }]}
      title="Articles per hour"
    />
    {#if p.scoreHistory.values.length > 1}
      <h2 class="dd-label">Score at each evaluation</h2>
      <TrendChart
        labels={p.scoreHistory.labels}
        series={[{ name: "Score", stream, values: p.scoreHistory.values }]}
        title="Score at each evaluation"
      />
    {/if}
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label">Score breakdown</h2>
    {#if p.breakdown}
      <p class="dd-body-sm text-ink-muted">
        Recomputed from the rubric stored at the last evaluation, with current counts, so it can differ from the
        stored score.
      </p>
      <BarChart items={p.breakdown.dims} max={4} title="Rubric dimensions, 0 to 4" />
      <dl class="grid gap-x-8 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        {#each terms as t (t.term)}
          <dt class="dd-label">{t.term}</dt>
          <dd class="dd-data">{t.value}</dd>
        {/each}
      </dl>
      {#key s.id}
        <AskButton purpose="explain" subjectKind="story" subjectId={s.id} label="Explain the score" />
      {/key}
    {:else}
      <p class="dd-body text-ink-muted">Not scored yet.</p>
    {/if}
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label">Ask Claude</h2>
    {#key s.id}
      <AskButton purpose="review" subjectKind="story" subjectId={s.id} label="Month in review" />
      <AskButton purpose="compare" subjectKind="story" subjectId={pairId(s.id, other)} label="Compare">
        <label class="dd-label">
          With story ID <input type="number" min="1" bind:value={other} class={input} />
        </label>
      </AskButton>
    {/key}
  </section>

  <section class="grid gap-6">
    <h2 class="dd-label">Facts</h2>
    {#each p.facts as group (group.status)}
      {#if group.rows.length}
        <h3 class="dd-subheading">{WORDS[group.status]}</h3>
        <div class="grid divide-y divide-line">
          {#each group.rows as f (f.id)}
            {@const sf = factStatusForm.for(f.id)}
            <div class="grid gap-2 py-2">
              <ol><FactRow status={f.status} text={f.text} sources={f.supporting.length} /></ol>
              <div class="dd-body-sm flex flex-wrap items-center gap-3 px-4 text-ink-muted">
                {#each f.supporting as a (a.id)}
                  <a href={art(a.id)} title={a.title ?? undefined} class="dd-tick">{padId("ART", a.id)}</a>
                {/each}
                <form {...sf} class="ml-auto flex items-center gap-2">
                  <input {...sf.fields.id.as("hidden", s.id)} />
                  <input {...sf.fields.fact.as("hidden", f.id)} />
                  <label class="dd-label">
                    Status
                    <select {...sf.fields.status.as("select", f.status)} class={input}>
                      {#each p.facts as g (g.status)}
                        <option value={g.status}>{WORDS[g.status]}</option>
                      {/each}
                    </select>
                  </label>
                  <Button type="submit" size="sm" variant="ghost">Set</Button>
                </form>
              </div>
              {@render issues(sf.fields.allIssues())}
            </div>
          {/each}
        </div>
      {/if}
    {/each}
    {#if noFacts}<p class="dd-body text-ink-muted">No facts extracted yet.</p>{/if}
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Articles</h2>
    <div class="overflow-x-auto">
      <table class="dd-body-sm w-full text-left">
        <thead class="dd-label">
          <tr>
            {#each ["ID", "Published", "Source", "Title", "Role", "Placed by"] as h (h)}
              <th class="py-2 pr-4">{h}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each p.articles as a (a.id)}
            <tr class="border-t border-line align-top">
              <td class="py-2 pr-4"><a href={art(a.id)} class="dd-tick">{padId("ART", a.id)}</a></td>
              <td class="dd-tick pr-4 whitespace-nowrap">{fmtTime(a.publishedAt)}</td>
              <td class="pr-4">
                <a href="/data/sources/{a.sourceId}">{a.sourceName}</a>
                <span class="dd-tick">Tier {a.tier}</span>
              </td>
              <td class="pr-4">
                <a href={a.canonicalUrl} class="hover:underline">{a.title}</a>
                {#if a.injectionSuspect}<span class="dd-label text-sev-high">Injection suspect</span>{/if}
              </td>
              <td class="pr-4 whitespace-nowrap">
                {#if a.originId === null}
                  Origin
                {:else}
                  Copy of <a href={art(a.originId)}>{padId("ART", a.originId)}</a>
                {/if}
              </td>
              <td>
                {#if a.match}
                  {word(a.match.how)}{#if a.match.cosine !== null}, cosine {a.match.cosine.toFixed(2)}{/if}
                {:else}
                  Not logged
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if p.vulns.length}
    <section class="grid gap-4">
      <h2 class="dd-label">Vulnerabilities</h2>
      <ul class="grid divide-y divide-line">
        {#each p.vulns as v (v.cveId)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <a href="https://www.cve.org/CVERecord?id={v.cveId}" class="dd-tick">{v.cveId}</a>
            {#if v.vendor || v.product}<span>{[v.vendor, v.product].filter(Boolean).join(" ")}</span>{/if}
            {#if v.cnaCvss !== null}<span>CVSS {v.cnaCvss.toFixed(1)}</span>{/if}
            <span>EPSS {v.epss === null ? "unknown" : `${(v.epss * 100).toFixed(1)}%`}</span>
            <span>{v.kevDateAdded === null ? "Not in KEV" : `In KEV since ${fmtDate(v.kevDateAdded)}`}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="grid gap-4">
    <h2 class="dd-label">Gate log</h2>
    {#if p.gates.length}
      <ul class="grid divide-y divide-line">
        {#each p.gates as g (g.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(g.at)}</span>
            <span class="font-semibold">{word(g.gate)}</span>
            <span>{g.decision === "pass" ? "Pass" : "Fail"}{g.shadow ? ", shadow" : ""}</span>
            <span class="text-ink-muted">{g.reasonsJson.join(", ")}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dd-body text-ink-muted">No gate decisions yet.</p>
    {/if}
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Deliveries</h2>
    {#if p.deliveries.length}
      <ul class="grid divide-y divide-line">
        {#each p.deliveries as dl (dl.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(dl.sentAt)}</span>
            <span class="font-semibold">{word(dl.kind)}</span>
            {#if dl.digestDate}<span>Digest {dl.digestDate}</span>{/if}
            {#if dl.scoreAtSend !== null}<span>Score at send {dl.scoreAtSend}</span>{/if}
            {#if dl.silent}<span>Silent</span>{/if}
            <span class="text-ink-muted">{dl.up} up, {dl.down} down</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dd-body text-ink-muted">Not delivered.</p>
    {/if}
  </section>

  {#if p.signals.length}
    <section class="grid gap-4">
      <h2 class="dd-label">Attention signals</h2>
      <ul class="grid divide-y divide-line">
        {#each p.signals as sg (sg.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(sg.observedAt)}</span>
            <span class="font-semibold">{word(sg.kind)}</span>
            <span>{sg.value}</span>
            {#if sg.ref}<span class="text-ink-muted">{sg.ref}</span>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if s.status !== "merged"}
    <section class="grid gap-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 class="dd-label">Actions</h2>
      <div class="flex flex-wrap items-start gap-8">
        <form {...closeForm.enhance(confirmed("Close this story?"))} class="grid gap-2">
          <input {...closeForm.fields.id.as("hidden", s.id)} />
          <Button type="submit" disabled={s.status === "closed"}>Close story</Button>
          {@render issues(closeForm.fields.allIssues())}
        </form>
        <form
          {...requeueForm.enhance(confirmed("Evaluate this story again? It spends Claude budget."))}
          class="grid gap-2"
        >
          <input {...requeueForm.fields.id.as("hidden", s.id)} />
          <Button type="submit">Evaluate again</Button>
          {@render issues(requeueForm.fields.allIssues())}
        </form>
        <SendNowButton storyId={s.id} title={s.title} />
        <form
          {...mergeForm.enhance(confirmed("Merge this story into the one you named? Its articles move there."))}
          class="grid gap-2"
        >
          <input {...mergeForm.fields.id.as("hidden", s.id)} />
          <div class="flex items-center gap-2">
            <label class="dd-label">
              Into story ID <input {...mergeForm.fields.into.as("number")} min="1" class={input} />
            </label>
            <Button type="submit">Merge</Button>
          </div>
          {@render issues(mergeForm.fields.allIssues())}
        </form>
        <form {...followForm} class="grid gap-2">
          <input {...followForm.fields.id.as("hidden", s.id)} />
          <div class="flex items-center gap-2">
            <label class="dd-label">
              Days <input {...followForm.fields.days.as("number")} min="1" class={input} />
            </label>
            <Button type="submit">Follow</Button>
          </div>
          {@render issues(followForm.fields.allIssues())}
        </form>
      </div>
    </section>
  {/if}

  <section class="grid gap-4">
    <h2 class="dd-label">Audit</h2>
    {#if p.audit.length}
      <ul class="grid divide-y divide-line">
        {#each p.audit as act (act.id)}
          <li class="dd-body-sm flex flex-wrap gap-x-6 gap-y-1 py-2">
            <span class="dd-tick whitespace-nowrap">{fmtTime(act.at)}</span>
            <span class="font-semibold">{word(act.kind)}</span>
            <span>{act.by}</span>
            {#each detailParts(act.detailJson) as part (part.label)}
              <span class="text-ink-muted">
                {part.label}
                {part.text}
                {#each part.links as l (l.href)}<a href={l.href} class="dd-tick">{l.label}</a>{" "}{/each}
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dd-body text-ink-muted">No dashboard actions on this story.</p>
    {/if}
  </section>
</div>
