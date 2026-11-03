<script lang="ts">
import { COUNTRIES, countryName, STATUS, sanitizeUserText } from "@digest/core"
import type { MoverKind, Profile, ProfileEdit } from "@digest/db"
import Button from "#lib/components/Button.svelte"
import { fmtTime } from "#lib/components/format.ts"
import LinkChip, { type Chip, countryChip, entityChip, threadChip } from "#lib/components/LinkChip.svelte"
import { follow } from "#lib/components/subject.remote.ts"
import { decideForm, profilePage, saveForm } from "./profile.remote.ts"

const EMPTY: Profile = {
  text: "",
  topics: [],
  follows: { threads: [], entities: [], countries: [] },
  regions: [],
  mutes: [],
}
const BLANK_TOPICS = Array.from({ length: STATUS.newTopicRows }, () => ({ name: "", weight: 2 }))
const REGIONS = Object.keys(COUNTRIES).toSorted((a, b) => countryName(a).localeCompare(countryName(b)))
const input = "rounded-lg border border-line-control bg-surface px-3 py-2 text-sm text-ink"
const f = saveForm.fields

/** One proposed edit in words; its values come from the model, so they are sanitized. */
const editText = (e: ProfileEdit) => {
  const v = sanitizeUserText("value" in e ? e.value : e.name)
  if (e.op === "set_topic") return `Topic ${v}, weight ${e.weight}`
  if (e.op === "remove_topic") return `Drop topic ${v}`
  if (e.op === "add_mute") return `Mute ${v}`
  if (e.op === "remove_mute") return `Unmute ${v}`
  if (e.op === "add_region") return `Add region ${countryName(v)}`
  if (e.op === "remove_region") return `Drop region ${countryName(v)}`
  return `Add to the text: ${v}`
}

let unfollowError = $state<string | null>(null)
const unfollow = async (kind: MoverKind, key: string) => {
  unfollowError = null
  try {
    await follow({ kind, key, on: false })
    await profilePage().refresh()
  } catch (e) {
    unfollowError = e instanceof Error ? e.message : String(e)
  }
}
</script>

<svelte:head>
  <title>Profile</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
  {#each list ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
{/snippet}

<div class="grid max-w-3xl gap-12 pt-8">
  <svelte:boundary>
    {@const { current, proposals, history, follows } = await profilePage()}
    {@const p = current?.profile ?? EMPTY}
    <header class="grid gap-2">
      <h1 class="dd-display">Profile</h1>
      <p class="dd-body-sm text-ink-muted">
        {current ? `Version ${current.version}, saved ${fmtTime(current.createdAt)}.` : "No profile saved yet."}
      </p>
    </header>

    {#if proposals.length}
      <section class="grid gap-4">
        <h2 class="dd-label">Proposed from your votes</h2>
        {#each proposals as pr (pr.id)}
          {@const df = decideForm.for(pr.id)}
          <form {...df} class="grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p class="dd-body text-pretty">{sanitizeUserText(pr.rationale)}</p>
            <ul class="dd-body-sm grid gap-1">
              {#each pr.editsJson as e, i (i)}<li>{editText(e)}</li>{/each}
            </ul>
            <p class="dd-tick">Based on version {pr.basedOnVersion}, {fmtTime(pr.createdAt)}</p>
            <input {...df.fields.id.as("hidden", pr.id)} />
            <div class="flex gap-2">
              <Button size="sm" variant="primary" {...df.fields.decision.as("submit", "accept")}>Accept</Button>
              <Button size="sm" {...df.fields.decision.as("submit", "reject")}>Reject</Button>
            </div>
            {@render issues(df.fields.allIssues())}
          </form>
        {/each}
      </section>
    {/if}

    <form {...saveForm} class="grid gap-6">
      <label class="dd-label grid gap-2">
        About you
        <textarea {...f.text.as("text", p.text)} rows="6" class="{input} dd-body"></textarea>
      </label>

      <fieldset class="grid gap-2">
        <legend class="dd-label pb-2">Topics, weight 1 for a passing interest to 3 for a core one</legend>
        {#each [...p.topics, ...BLANK_TOPICS] as t, i (i)}
          {@const row = f.topics[i]}
          {#if row}
            <div class="grid grid-cols-[1fr_5rem] gap-2">
              <input {...row.name.as("text", t.name)} aria-label="Topic" placeholder="New topic" class={input} />
              <input {...row.weight.as("number", t.weight)} aria-label="Weight" min="1" max="3" class={input} />
            </div>
          {/if}
        {/each}
        <p class="dd-body-sm text-ink-muted">Clear a name to drop the topic.</p>
        {@render issues(f.topics.allIssues())}
      </fieldset>

      <div class="grid gap-6 sm:grid-cols-2">
        <label class="dd-label grid content-start gap-2">
          Regions that matter more
          <select {...f.regions.as("select multiple", p.regions)} size="10" class={input}>
            {#each REGIONS as code (code)}<option value={code}>{countryName(code)}</option>{/each}
          </select>
          {@render issues(f.regions.issues())}
        </label>
        <label class="dd-label grid content-start gap-2">
          Never worth sending, one per line
          <textarea {...f.mutes.as("text", p.mutes.join("\n"))} rows="10" class="{input} dd-body"></textarea>
        </label>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <label class="dd-label grid grow gap-2">
          What changed
          <input {...f.note.as("text")} placeholder="Edited on the dashboard" class={input} />
        </label>
        <Button type="submit" variant="primary">Save</Button>
      </div>
      {@render issues(f.allIssues())}
    </form>

    <section class="grid gap-4">
      <h2 class="dd-label">Following</h2>
      {#snippet followed(kind: MoverKind, key: string, chip: Chip)}
        <li class="flex items-center gap-1">
          <LinkChip {...chip} />
          <Button size="sm" variant="ghost" onclick={() => unfollow(kind, key)}>Unfollow</Button>
        </li>
      {/snippet}
      <ul class="flex flex-wrap gap-3">
        {#each follows.threads as t (t.id)}{@render followed("thread", String(t.id), threadChip(t))}{/each}
        {#each follows.entities as e (e.key)}{@render followed("entity", e.key, entityChip(e))}{/each}
        {#each p.follows.countries as c (c)}{@render followed("country", c, countryChip(c))}{/each}
      </ul>
      {#if !follows.threads.length && !follows.entities.length && !p.follows.countries.length}
        <p class="dd-body text-ink-muted">Nothing followed. Follow a thread, entity or country from its page.</p>
      {/if}
      {#if unfollowError}<p class="dd-body-sm text-sev-high">{unfollowError}</p>{/if}
    </section>

    <section class="grid gap-4">
      <h2 class="dd-label">History</h2>
      <div class="overflow-x-auto">
        <table class="dd-body-sm w-full text-left">
          <thead class="dd-label">
            <tr>
              {#each ["Version", "When", "By", "Note"] as h (h)}<th class="py-2 pr-4">{h}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each history as v (v.version)}
              <tr class="border-t border-line align-top">
                <td class="dd-data py-2 pr-4">{v.version}</td>
                <td class="dd-tick py-2 pr-4 whitespace-nowrap">{fmtTime(v.createdAt)}</td>
                <td class="py-2 pr-4">{v.by}</td>
                <td class="py-2 text-ink-muted">{v.note ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#snippet pending()}
      <p class="dd-label py-6">Loading</p>
    {/snippet}
    {#snippet failed()}
      <p class="dd-label py-6 text-ink-muted">Could not load the profile</p>
    {/snippet}
  </svelte:boundary>
</div>
