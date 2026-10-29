<script lang="ts">
import {
  Button,
  Delta,
  FactRow,
  Readout,
  SearchField,
  SegmentedControl,
  SeverityBadge,
  SeverityMeter,
  SignalChip,
  SourceList,
  StatusLamp,
  StoryCard,
  StreamTag,
  Topbar,
  Wordmark,
} from "#lib/components/index.ts"

const now = Date.now()
const hour = 3_600_000
const ranges = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
]
let range = $state("7d")
</script>

<svelte:head>
  <title>Styleguide</title>
</svelte:head>

{#snippet lamps()}
  <StatusLamp state="live" label="Live" />
{/snippet}

{#snippet search()}
  <SearchField name="q" placeholder="Search" action="/search" />
{/snippet}

<main class="mx-auto grid max-w-7xl gap-12 px-4 py-8 sm:px-8">
  <h1 class="dd-display">Styleguide</h1>

  <section class="grid gap-4">
    <h2 class="dd-label">Topbar and wordmark</h2>
    <div class="rounded-lg border border-line bg-surface">
      <Topbar
        nav={[
          { href: "/", label: "Brief" },
          { href: "/stories", label: "Stories" },
          { href: "/styleguide", label: "Styleguide" },
        ]}
        current="/styleguide"
        {lamps}
        {search}
      />
    </div>
    <Wordmark />
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Type</h2>
    <p class="dd-title">Patch wave follows OpenSSH disclosure</p>
    <p class="dd-heading">Rising signals</p>
    <p class="dd-subheading">Global trendlines</p>
    <p class="dd-body">Eleven outlets now report the same disclosure window.</p>
    <p class="dd-body-sm text-ink-muted">First reported by Nordic Wire at 05:40Z.</p>
    <p class="dd-readout">3 of 5</p>
    <p class="dd-data">+340%</p>
    <p class="dd-tick">06:00Z</p>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Readout</h2>
    <div class="grid gap-4 sm:grid-cols-3">
      <Readout label="Active stories" value={128}>
        {#snippet foot()}<Delta pct={12} /><span>since yesterday</span>{/snippet}
      </Readout>
      <Readout label="Articles" value={14_203} href="/styleguide">
        {#snippet foot()}<Delta pct={-8} /><span>last 14 days</span>{/snippet}
      </Readout>
      <Readout label="Spend today" value="0.42" unit="USD" />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Delta</h2>
    <div class="flex flex-wrap gap-3">
      <Delta pct={340} />
      <Delta pct={-12.4} />
      <Delta pct={0} />
      <Delta pct={null} previous={0} recent={4} />
      <Delta pct={null} />
      <Delta pct={27} suffix="24h" />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Stream tag</h2>
    <div class="flex flex-wrap gap-3">
      <StreamTag stream="world" />
      <StreamTag stream="tech" />
      <StreamTag stream="security" />
      <StreamTag stream="fi" />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Severity badge</h2>
    <div class="flex flex-wrap gap-3">
      <SeverityBadge score={null} />
      <SeverityBadge score={50} />
      <SeverityBadge score={62} />
      <SeverityBadge score={80} />
      <SeverityBadge score={93} />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Severity meter</h2>
    <div class="max-w-md">
      <SeverityMeter
        label="Threat level, Security"
        level={3}
        note="Driven by 14 active signals. Up from Low at 00:00Z."
        lamp={lamps}
      />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Status lamp</h2>
    <div class="flex flex-wrap gap-6">
      <StatusLamp state="live" label="Live" />
      <StatusLamp state="stale" label="Stale 3h" />
      <StatusLamp state="off" label="Paused" />
      <StatusLamp state="alert" label="Critical signal" />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Signal chip</h2>
    <div class="flex flex-wrap gap-3">
      <SignalChip id={412} name="Post-quantum TLS" pct={340} href="/styleguide" />
      <SignalChip id={77} name="Baltic cables" pct={-35} href="/styleguide" />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Story card</h2>
    <StoryCard
      id={2291}
      stream="security"
      score={91}
      updatedAt={now - 2 * hour}
      title="Patch wave follows OpenSSH pre-auth disclosure"
      summary="Fixed releases shipped for all supported branches. Scanning for exposed hosts tripled overnight."
      stats={[
        { name: "Articles", value: 23 },
        { name: "Sources", value: 11 },
        { name: "Facts", value: 6 },
      ]}
      lead
    >
      {#snippet momentum()}<Delta pct={180} />{/snippet}
      {#snippet chips()}
        <SignalChip id={412} name="OpenSSH" pct={340} href="/styleguide" />
      {/snippet}
    </StoryCard>
    <div class="grid gap-6 md:grid-cols-2">
      <StoryCard
        id={2283}
        stream="world"
        score={64}
        updatedAt={now - 30 * hour}
        title="Second Baltic cable fault in a week slows Nordic traffic"
        summary="Operators are rerouting through land links."
        stats={[
          { name: "Articles", value: 16 },
          { name: "Sources", value: 9 },
        ]}
      />
      <StoryCard
        id={2290}
        stream="fi"
        score={null}
        updatedAt={now - hour}
        title="Helsinki adds night trams on two lines"
        summary="The trial runs until March."
        stats={[
          { name: "Articles", value: 3 },
          { name: "Sources", value: 2 },
        ]}
      >
        {#snippet facts()}
          <ol class="divide-y divide-line">
            <FactRow status="active" text="The trial runs until March." sources={2} />
          </ol>
        {/snippet}
      </StoryCard>
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Fact rows</h2>
    <ol class="divide-y divide-line rounded-lg border border-line bg-surface p-2 shadow-sm">
      <FactRow status="active" text="Fixed releases shipped for all supported branches on 26 October." sources={6} />
      <FactRow status="superseded" text="Only the 9.x branch is affected." sources={1} href="/styleguide" />
      <FactRow status="contradicted" text="Two large cloud providers were affected before patching." sources={3} />
    </ol>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Source list</h2>
    <div class="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <SourceList
        items={[
          {
            id: 1,
            title: "OpenSSH project discloses pre-authentication flaw",
            href: "https://example.com/1",
            at: now - 26 * hour,
            outlet: "Nordic Wire",
            role: "First report",
          },
          {
            id: 2,
            title: "What the OpenSSH flaw means for exposed servers",
            href: "https://example.com/2",
            at: now - 3 * hour,
            outlet: "Example Tech",
          },
        ]}
      />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Segmented control</h2>
    <div class="flex flex-wrap gap-4">
      <SegmentedControl label="Time range" options={ranges} value={range} onchange={(v) => (range = v)} />
      <SegmentedControl
        label="Time range as links"
        options={ranges.map((r) => ({ ...r, href: `?range=${r.value}` }))}
        value="24h"
      />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Search field</h2>
    <div class="max-w-md">
      <SearchField name="q" placeholder="Search stories, signals, CVEs" />
    </div>
  </section>

  <section class="grid gap-4">
    <h2 class="dd-label">Buttons</h2>
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="primary">Open today's digest</Button>
      <Button>Track signal</Button>
      <Button variant="ghost">Dismiss</Button>
      <Button size="sm" href="/styleguide">Small link</Button>
      <Button size="lg" disabled>Disabled</Button>
    </div>
  </section>
</main>
