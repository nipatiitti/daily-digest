<script lang="ts">
import SubjectPage from "#lib/components/SubjectPage.svelte"
import { page } from "$app/state"
</script>

<SubjectPage kind="entity" key={page.params.key ?? ""} />
