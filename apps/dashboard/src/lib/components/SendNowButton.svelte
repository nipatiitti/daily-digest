<script lang="ts">
import { sendNowForm } from "../../routes/digest/digest.remote.ts"
import Button from "./Button.svelte"

type Props = { storyId: number; title: string }

let { storyId, title }: Props = $props()

const f = $derived(sendNowForm.for(storyId))
</script>

<!-- Sends the story to every digest chat as an alert, after the browser's confirm dialog. -->
<form
  {...f.enhance(async (form) => {
    if (confirm(`Send "${title}" to Telegram now? Every digest chat gets it as an alert.`)) await form.submit()
  })}
  class="grid gap-2"
>
  <input {...f.fields.id.as("hidden", storyId)} />
  <Button type="submit" disabled={f.pending > 0}>Send to Telegram now</Button>
  {#if f.result}
    <p class="dd-body-sm text-ink-muted">Sent to {f.result.sent} {f.result.sent === 1 ? "chat" : "chats"}.</p>
  {/if}
  {#each f.fields.allIssues() ?? [] as issue, i (i)}
    <p class="dd-body-sm text-sev-high">{issue.message}</p>
  {/each}
</form>
