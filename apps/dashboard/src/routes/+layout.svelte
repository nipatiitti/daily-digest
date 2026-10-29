<script lang="ts">
import "../app.css"
import { SearchField, StatusLamp, Topbar } from "#lib/components/index.ts"
import { page } from "$app/state"
import type { LayoutProps } from "./$types"
import { lamps, user } from "./lamps.remote.ts"

const { children }: LayoutProps = $props()

const nav = [
  { href: "/", label: "Brief" },
  { href: "/signals", label: "Signals" },
  { href: "/stories", label: "Stories" },
  { href: "/entities", label: "Entities" },
  { href: "/sources", label: "Sources" },
  { href: "/ops", label: "Ops" },
  { href: "/data", label: "Data" },
]
</script>

<svelte:head>
  <title>Daily digest</title>
</svelte:head>

{#snippet statusLamps()}
  <!-- The server renders nothing here; the lamps load after hydration so the D1 reads never hold up the page. -->
  <svelte:boundary>
    {#each await lamps() as lamp (lamp.label)}
      <span title={lamp.title}><StatusLamp state={lamp.state} label={lamp.label} /></span>
    {/each}
    {#snippet pending()}{/snippet}
    {#snippet failed()}
      <StatusLamp state="off" label="Status unavailable" />
    {/snippet}
  </svelte:boundary>
{/snippet}

{#snippet search()}
  <SearchField name="q" placeholder="Search stories" action="/stories" />
{/snippet}

<Topbar {nav} current={page.url.pathname} lamps={statusLamps} {search} />

<main class="mx-auto max-w-320 px-4 pb-16 sm:px-8">
  {@render children()}
</main>

<footer class="dd-label mx-auto flex max-w-320 gap-4 px-4 pb-8 text-ink-subtle sm:px-8">
  <span>{await user()}</span>
  <span>UTC</span>
</footer>
