import Link from "next/link";

import { BuyerShell, Metric, Panel, StatusPill } from "@/components/buyer-shell";
import {
  getBuyerEngineEnvStatus,
  getDashboardSnapshot,
  getLiveCountyCapabilities,
  getOperatorShellStatus,
  listAllBuyerReports,
  listExports,
  listSearchJobs,
} from "@/lib/buyer-engine-server";

function formatPropertyType(value: string) {
  return value.replaceAll("_", " ");
}

export async function BuyerEngineHome() {
  const env = getBuyerEngineEnvStatus();
  const counties = await getLiveCountyCapabilities(true);
  const [liveJobs, liveReportPage, dashboardSnapshot, recentExports, operatorStatus] = env.enabled
    ? await Promise.all([
        listSearchJobs(6).catch(() => []),
        listAllBuyerReports({ limit: 1, offset: 0 }).catch(() => ({
          reports: [],
          total: 0,
          limit: 1,
          offset: 0,
        })),
        getDashboardSnapshot().catch(() => ({
          operatorId: null,
          searchJobCount: 0,
          completedJobCount: 0,
          processingJobCount: 0,
          failedJobCount: 0,
          buyerReportCount: 0,
          exportCount: 0,
          outreachDraftCount: 0,
        })),
        listExports({ limit: 5 }).catch(() => []),
        getOperatorShellStatus().catch(() => null),
      ])
    : [
        [],
        { reports: [], total: 0, limit: 1, offset: 0 },
        {
          operatorId: null,
          searchJobCount: 0,
          completedJobCount: 0,
          processingJobCount: 0,
          failedJobCount: 0,
          buyerReportCount: 0,
          exportCount: 0,
          outreachDraftCount: 0,
        },
        [],
        null,
      ];

  // Real operator-scoped jobs only — no sample/reference fallback.
  const operatorJobs = liveJobs.map((job) => ({
    id: job.id,
    title: `${job.county} ${formatPropertyType(job.property_type)} buyers sweep`,
    county: job.county,
    state: job.state,
    propertyType: job.property_type,
    status: job.status,
    dateRange: `${job.date_range_start ?? "n/a"} to ${job.date_range_end ?? "n/a"}`,
    buyersFound: job.total_buyers_found ?? 0,
    salesAnalyzed: job.total_sales_analyzed ?? 0,
    notes: job.error_message ?? undefined,
  }));

  const stats = {
    activeCountyCount: counties.filter((county) => county.status === "active").length,
    completedRuns: dashboardSnapshot.completedJobCount,
    totalBuyers: dashboardSnapshot.buyerReportCount || liveReportPage.total,
  };

  const approvedCounties = counties.filter(
    (county) => county.status === "active" && county.supportsPast90Days,
  );

  const readinessRows = [
    {
      key: "OPENAI_API_KEY",
      purpose: "AI generation modules and server actions",
      status: process.env.OPENAI_API_KEY ? "configured" : "missing",
    },
    {
      key: "SUPABASE_URL",
      purpose: "Buyer Engine read/write integration",
      status: process.env.SUPABASE_URL ? "configured" : "missing",
    },
    {
      key: "SUPABASE_ANON_KEY",
      purpose: "client-side Supabase access",
      status: process.env.SUPABASE_ANON_KEY ? "configured" : "missing",
    },
    {
      key: "SUPABASE_SERVICE_ROLE_KEY",
      purpose: "server-side admin and workflow handoff",
      status: process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "missing",
    },
    {
      key: "BLACKSPIRE_DEFAULT_USER_ID",
      purpose: "Deprecated bootstrap bridge — operator auth is live; safe to remove",
      status: env.hasDefaultUserId ? "deprecated" : "not set",
    },
  ] as const;

  const commandSignals = [
    {
      label: "County Surface",
      value: `${stats.activeCountyCount} live`,
      detail: "County rows actively supporting the current acquisition surface.",
    },
    {
      label: "Dossier Volume",
      value: `${stats.totalBuyers}`,
      detail: "Live buyer reports available to operators right now.",
    },
    {
      label: "Run Completion",
      value: `${stats.completedRuns}`,
      detail: "Completed sweeps already pushed through the current stack.",
    },
  ];

  const heroSignals = [
    env.enabled ? "Supabase path online" : "Supabase contract incomplete",
    operatorStatus?.signedIn
      ? "real operator session"
      : operatorStatus?.bootstrapRequired
        ? "bootstrap operator path"
        : "auth gate still matters",
    dashboardSnapshot.processingJobCount
      ? `${dashboardSnapshot.processingJobCount} runs processing`
      : "queue calm right now",
  ];

  const commandLanes = [
    {
      label: "Deal Relay",
      description: "Move from seller-qualified opportunity into underwriting and disposition packaging.",
      href: "/workspace/deal-engine",
    },
    {
      label: "Sweep Launch",
      description: "County-targeted search jobs with operator-aware scope and async dispatch.",
      href: "/searches/new",
    },
    {
      label: "Dossier Review",
      description: "Buyer report rendering, summaries, and exports for active acquisition campaigns.",
      href: "/buyers",
    },
    {
      label: "Reverse Search",
      description: "Start from buyer criteria and rank seller-side or deal-side opportunities already in the pipeline.",
      href: "/workspace/buyer-engine/reverse-search",
    },
    {
      label: "Queue Monitor",
      description: "Live search-job visibility, retries, and operational pulse across the workflow layer.",
      href: "/searches",
    },
  ];

  const scoreTone =
    operatorStatus?.signedIn
      ? "good"
      : operatorStatus?.bootstrapRequired
        ? "warn"
        : operatorStatus?.requiresAuth
          ? "bad"
          : "neutral";

  return (
    <BuyerShell
      eyebrow="Command Deck"
      title="Blackspire Buyer Engine Workspace"
      description="The premium operating layer for land-buyer intelligence, county readiness, and operator execution across the Blackspire stack."
      operatorStatus={operatorStatus}
    >
      <section className="brand-panel overflow-hidden px-6 py-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[38%] bg-[radial-gradient(circle_at_center,hsl(35_100%_62%/.12),transparent_72%)]" />
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="relative space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">
                Intel Chamber
              </p>
              <h3 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                A luxury operator view for land intelligence, not a commodity dashboard.
              </h3>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                The system is built to launch sweeps, qualify buyer momentum, and keep the operator
                trail visible without forcing the team to bounce between admin screens and rough
                utility views.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/searches/new" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Launch buyer sweep
              </Link>
              <Link href="/workspace/buyer-engine/reverse-search" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Run reverse search
              </Link>
              <Link href="/buyers" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Open dossiers
              </Link>
              <Link href="/workspace/deal-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Open Deal Engine
              </Link>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {commandSignals.map((signal) => (
                <div key={signal.label} className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">
                    {signal.label}
                  </div>
                  <div className="brand-accent-text mt-3 text-2xl font-semibold">{signal.value}</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{signal.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative grid gap-4 content-start">
            <div className="brand-card overflow-hidden p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--gold-soft)]">
                    Operator posture
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white">Acquisition signal</div>
                </div>
                <StatusPill tone={scoreTone} label={heroSignals[1]} />
              </div>
              <div className="mt-5 space-y-3">
                {heroSignals.map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                    <span className="h-2 w-2 rounded-full bg-[var(--gold)] shadow-[0_0_16px_hsl(33_100%_55%/.45)]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="brand-card p-5">
              <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">
                Command lanes
              </div>
              <div className="mt-4 space-y-3">
                {commandLanes.map((lane) => (
                  <Link
                    key={lane.href}
                    href={lane.href}
                    className="block rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-4 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                  >
                    <div className="text-base font-semibold text-white">{lane.label}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{lane.description}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric
          label="Active Counties"
          value={String(stats.activeCountyCount)}
          detail="County source rows currently marked active"
        />
        <Metric
          label="Completed Jobs"
          value={String(stats.completedRuns)}
          detail="Completed SearchJob rows for the current operator scope"
        />
        <Metric
          label="Live Buyer Reports"
          value={String(stats.totalBuyers)}
          detail="Current BuyerReport count in the live system"
        />
        <Metric
          label="Primary Risk"
          value={
            operatorStatus?.signedIn
              ? "operator trail"
              : operatorStatus?.bootstrapRequired
                ? "bootstrap mode"
                : operatorStatus?.requiresAuth
                  ? "sign-in gate"
                  : "operator state"
          }
          detail={
            operatorStatus?.signedIn
              ? "The app is now working through a real signed-in operator session."
              : operatorStatus?.bootstrapRequired
                ? "No auth users exist yet. /auth can bootstrap the first operator."
                : operatorStatus?.requiresAuth
                  ? "Operator accounts exist. Sign in through /auth to create and read scoped data."
                  : "Operator status could not be resolved cleanly."
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
        <Panel
          eyebrow="Inside the workspace"
          title="Everything the Buyer Engine workspace runs"
          description="Live data at the center, operator context on the edges, and a clear next action at every step — built for serious acquisition operators."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="brand-card p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Included</p>
              <ul className="brand-copy-soft mt-4 space-y-3 text-sm leading-6">
                <li>County buyer sweeps dispatched to the live n8n workflow</li>
                <li>Search-jobs monitor with retry and live highlight flow</li>
                <li>Buyer Reports rendering scored, ranked buyer dossiers</li>
                <li>Realtime updates with automatic polling fallback</li>
                <li>One-click CSV export with a recoverable export ledger</li>
                <li>AI buyer summaries and outreach draft generation</li>
                <li>Secure operator sign-in and admin controls</li>
              </ul>
            </div>
            <div className="brand-card p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">What that gets you</p>
              <ul className="brand-copy-soft mt-4 space-y-3 text-sm leading-6">
                <li>Every buyer captured and scored automatically</li>
                <li>Faster dispositions — buyers matched to deals in seconds</li>
                <li>A recoverable trail of exports and outreach, not clipboard work</li>
                <li>One secure command surface instead of scattered spreadsheets</li>
              </ul>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Environment"
          title="Integration status"
          description="Live status of the integrations that power the workspace."
        >
          <div className="space-y-3">
            {readinessRows.map((item) => (
              <div key={item.key} className="brand-card grid gap-2 px-4 py-4 sm:grid-cols-[1fr_1.2fr_auto]">
                <div className="text-sm font-medium text-white">{item.key}</div>
                <div className="brand-copy-soft text-sm">{item.purpose}</div>
                <div
                  className={`text-xs uppercase tracking-[0.24em] ${
                    item.status === "configured" ? "text-[hsl(40_100%_72%)]" : "text-[hsl(16_100%_66%)]"
                  }`}
                >
                  {item.status}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          eyebrow="Operations Pulse"
          title="Live operator snapshot"
          description="These counts are server-read from the current project scope and staged like a mission room, not a spreadsheet."
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                Search jobs
              </div>
              <div className="mt-2 text-3xl font-semibold text-white tabular-nums">
                {dashboardSnapshot.searchJobCount}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill tone="active" label={`${dashboardSnapshot.completedJobCount} completed`} />
                <StatusPill tone="good" label={`${dashboardSnapshot.processingJobCount} processing`} />
                {dashboardSnapshot.failedJobCount ? (
                  <StatusPill tone="bad" label={`${dashboardSnapshot.failedJobCount} failed`} />
                ) : null}
              </div>
            </div>
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                Export records
              </div>
              <div className="mt-2 text-3xl font-semibold text-white tabular-nums">
                {dashboardSnapshot.exportCount}
              </div>
              <div className="brand-copy-soft mt-1 text-xs">CSV actions recorded in Supabase</div>
            </div>
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                Saved drafts
              </div>
              <div className="mt-2 text-3xl font-semibold text-white tabular-nums">
                {dashboardSnapshot.outreachDraftCount}
              </div>
              <div className="brand-copy-soft mt-1 text-xs">
                Server-side outreach drafts in private storage
              </div>
            </div>
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                Operator scope
              </div>
              <div className="mt-2 break-all text-sm font-medium text-white">
                {dashboardSnapshot.operatorId ?? "Fallback default operator"}
              </div>
              <div className="brand-copy-soft mt-1 text-xs">
                The app uses this owner id when reading and writing scoped records
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="County Coverage"
          title="Live source network snapshot"
          description="The dashboard now shows the real county surface area already earned in the workflow layer."
        >
          <div className="brand-table-shell">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="brand-table-head">
                <tr>
                  <th className="px-4 py-3 font-medium">County</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Date format</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {approvedCounties.slice(0, 12).map((county) => (
                  <tr
                    key={`${county.county}-${county.sourceTypes.join(",")}`}
                    className="brand-table-row"
                  >
                    <td className="px-4 py-3">
                      <div>{county.county}</div>
                      {county.notes[0] ? (
                        <div className="brand-copy-muted mt-1 text-xs">{county.notes[0]}</div>
                      ) : null}
                    </td>
                    <td className="brand-copy-soft px-4 py-3 font-mono text-xs">
                      {county.sourceTypes.join(", ")}
                    </td>
                    <td className="px-4 py-3">{county.dateFormats.join(", ")}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone="good" label="90-day ready" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          eyebrow="Search Health"
          title="Recent live jobs"
          description="Live SearchJob feed for the current operator scope. Launch a sweep to populate this panel."
        >
          <div className="space-y-3">
            {operatorJobs.length === 0 ? (
              <div className="brand-card brand-copy-soft p-4 text-sm">
                {operatorStatus?.signedIn
                  ? "No search jobs yet in your operator scope. Launch a buyer sweep to see live runs here."
                  : "Sign in through /auth to see your live search jobs."}
              </div>
            ) : null}
            {operatorJobs.map((job) => (
              <div key={job.id} className="brand-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{job.title}</h3>
                    <p className="brand-copy-soft mt-1 text-sm">
                      {job.state} / {job.county} / {job.propertyType}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      job.status === "completed"
                        ? "active"
                        : job.status === "failed"
                          ? "bad"
                          : "neutral"
                    }
                    label={job.status}
                  />
                </div>
                <div className="brand-copy-soft mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    Range: <span className="tabular-nums">{job.dateRange}</span>
                  </div>
                  <div>
                    Buyers: <span className="tabular-nums">{job.buyersFound}</span>
                  </div>
                  <div>
                    Sales: <span className="tabular-nums">{job.salesAnalyzed}</span>
                  </div>
                </div>
                {job.notes ? <p className="brand-copy-muted mt-3 text-sm">{job.notes}</p> : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Operator Trail"
          title="Recent export activity"
          description="The operator artifact trail stays visible on the workspace instead of hiding behind secondary pages."
        >
          <div className="space-y-3">
            {recentExports.length ? (
              recentExports.map((record) => (
                <div key={record.id} className="brand-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{record.file_name}</div>
                      <div className="brand-copy-muted mt-1 font-mono text-xs">
                        {record.search_job_id ?? "no search job id"}
                      </div>
                    </div>
                    <StatusPill tone="good" label={`${record.row_count ?? 0} rows`} />
                  </div>
                  <div className="brand-copy-soft mt-3 text-sm">{record.storage_path}</div>
                  <div className="brand-copy-muted mt-2 text-xs">
                    {new Date(record.created_at).toLocaleString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="brand-card brand-copy-soft p-4 text-sm">
                No export records yet in the current operator scope.
              </div>
            )}
          </div>
        </Panel>
      </div>

    </BuyerShell>
  );
}
