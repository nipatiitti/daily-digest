<script lang="ts">
import "../app.css"
import Topbar from "#lib/components/Topbar.svelte"
import { page } from "$app/state"
import type { LayoutProps } from "./$types"

const { children, data }: LayoutProps = $props()

const nav = [
  { href: "/", label: "Home" },
  { href: "/threads", label: "Threads" },
  { href: "/digest", label: "Digest" },
  { href: "/profile", label: "Profile" },
  { href: "/status", label: "Status" },
]
</script>

<svelte:head>
  <title>Daily digest</title>
</svelte:head>

<Topbar {nav} current={page.url.pathname} />

<main class="mx-auto max-w-320 px-4 pb-16 sm:px-8">
  {@render children()}
</main>

<footer class="dd-label mx-auto flex max-w-320 gap-4 px-4 pb-8 text-ink-subtle sm:px-8">
  <span>{data.user}</span>
  <span>UTC</span>
</footer>
