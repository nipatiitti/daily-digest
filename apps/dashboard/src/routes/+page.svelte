<script lang="ts">
const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date())
</script>

<!-- Placeholder front page; the brief replaces it. -->
<h1 class="dd-display pt-8">Daily digest</h1>
<p class="dd-label pt-2 text-ink-muted">{today} UTC</p>
