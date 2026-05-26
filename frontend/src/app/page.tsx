import Link from "next/link";

import { BuyerShell, Metric, Panel, StatusPill } from "@/components/buyer-shell";
import {
  pendingWork,
  searchJobSnapshots,
} from "@/lib/buyer-engine-data";
import {
  getBuyerEngineEnvStatus,
  getDashboardSnapshot,
  getLiveCountyCapabilities,
  getOperatorShellStatus,
  listAllBuyerReports,
  listExports,
  listSearchJobs,
} from "@/lib/buyer-engine-server";

export default async function Home() {
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
  const referenceJobs = liveJobs.length
    ? liveJobs.map((job) => ({
        id: job.id,
        title: `${job.county} ${job.property_type.replace("_", " ")} buyers sweep`,
        county: job.county,
        state: job.state,
        propertyType: job.property_type,
        status: job.status,
        dateRange: `${job.date_range_start ?? "n/a"} to ${job.date_range_end ?? "n/a"}`,
        buyersFound: job.total_buyers_found ?? 0,
        salesAnalyzed: job.total_sales_analyzed ?? 0,
        notes: job.error_message ?? undefined,
      }))
    : searchJobSnapshots;
  const stats = {
    activeCountyCount: counties.filter((county) => county.status === "active").length,
    completedRuns: dashboardSnapshot.completedJobCount || referenceJobs.filter((job) => job.status === "completed").length,
    totalBuyers: dashboardSnapshot.buyerReportCount || liveReportPage.total || referenceJobs.reduce((sum, job) => sum + job.buyersFound, 0),
  };
  const approvedCounties = counties.filter((county) => county.status === "active" && county.supportsPast90Days);
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
      purpose: "bridge identity until auth is wired",
      status: env.hasDefaultUserId ? "configured" : "missing",
    },
  ] as const;

  return (
    <BuyerShell
      eyebrow="Command Deck"
      title="Blackspire Buyer Engine Workspace"
      description="Blackspire Buyer Engine is a Blackspire Helix Group product focused on buyer intelligence workflows. The frontend now has live search-job creation, workflow dispatch, a polling queue monitor, and buyer dossier rendering against the real Supabase project."
      operatorStatus={operatorStatus}
    >
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Active Counties" value={String(stats.activeCountyCount)} detail="County source rows currently marked active" />
        <Metric label="Completed Jobs" value={String(stats.completedRuns)} detail="Completed SearchJob rows for the current operator scope" />
        <Metric label="Live Buyer Reports" value={String(stats.totalBuyers)} detail="Current BuyerReport count in the live system" />
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

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Reality Check"
          title="What changed in the repo"
          description="The repo is operating as a real command surface now. What remains is backend hardening, admin tooling, and durable operator artifacts."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="brand-card p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Now in place</p>
              <ul className="brand-copy-soft mt-3 space-y-2 text-sm leading-6">
                <li>Real SearchJob inserts into Supabase</li>
                <li>Asynchronous n8n webhook dispatch after launch</li>
                <li>Search Jobs monitor with retry and highlight flow</li>
                <li>Buyer Reports route rendering live BuyerReport rows</li>
                <li>Realtime subscriptions with polling fallback</li>
                <li>CSV export logging and outreach draft generation</li>
                <li>Operator auth bootstrap and cookie-based sign-in</li>
              </ul>
            </div>
            <div className="brand-card p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Still open</p>
              <ul className="brand-copy-soft mt-3 space-y-2 text-sm leading-6">
                <li>Retire the default-user fallback once the first operator account is created</li>
                <li>Fully live dashboard metrics and history</li>
                <li>County administration and role management</li>
                <li>Operational analytics beyond the current queue and dossier views</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/searches/new"
              className="brand-button inline-flex px-4 py-3 text-sm transition"
            >
              Launch a buyer sweep
            </Link>
            <Link
              href="/buyers"
              className="brand-button inline-flex px-4 py-3 text-sm transition"
            >
              Review buyer dossiers
            </Link>
            <Link
              href="/searches"
              className="brand-button inline-flex px-4 py-3 text-sm transition"
            >
              Watch the queue
            </Link>
          </div>
        </Panel>

        <Panel
          eyebrow="System Readiness"
          title="Environment contract"
          description="These values are active in the repo. The remaining risk is operational behavior and workflow reliability."
        >
          <div className="space-y-3">
            {readinessRows.map((item) => (
              <div key={item.key} className="brand-card grid gap-2 px-4 py-3 sm:grid-cols-[1fr_1.2fr_auto]">
                <div className="text-sm font-medium text-white">{item.key}</div>
                <div className="brand-copy-soft text-sm">{item.purpose}</div>
                <div
                  className={`text-xs uppercase tracking-[0.24em] ${
                    item.status === "configured" ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {item.status}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          eyebrow="Operations Pulse"
          title="Live operator snapshot"
          description="These counts are server-read from the current project scope rather than derived from sample fixtures."
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Search jobs</div>
              <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{dashboardSnapshot.searchJobCount}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusPill tone="active" label={`${dashboardSnapshot.completedJobCount} completed`} />
                <StatusPill tone="good" label={`${dashboardSnapshot.processingJobCount} processing`} />
                {dashboardSnapshot.failedJobCount ? <StatusPill tone="bad" label={`${dashboardSnapshot.failedJobCount} failed`} /> : null}
              </div>
            </div>
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Export records</div>
              <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{dashboardSnapshot.exportCount}</div>
              <div className="brand-copy-soft mt-1 text-xs">CSV actions recorded in Supabase</div>
            </div>
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Saved drafts</div>
              <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{dashboardSnapshot.outreachDraftCount}</div>
              <div className="brand-copy-soft mt-1 text-xs">Server-side outreach drafts in private storage</div>
            </div>
            <div className="brand-card p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Operator scope</div>
              <div className="mt-2 text-sm font-medium text-white break-all">
                {dashboardSnapshot.operatorId ?? "Fallback default operator"}
              </div>
              <div className="brand-copy-soft mt-1 text-xs">The app uses this owner id when reading and writing scoped records</div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="County Coverage"
          title="Live source network snapshot"
          description="The dashboard now shows the real county surface area we've already earned in the workflow layer."
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
                  <tr key={`${county.county}-${county.sourceTypes.join(",")}`} className="brand-table-row">
                    <td className="px-4 py-3">
                      <div>{county.county}</div>
                      {county.notes[0] ? <div className="brand-copy-muted mt-1 text-xs">{county.notes[0]}</div> : null}
                    </td>
                    <td className="brand-copy-soft px-4 py-3 font-mono text-xs">{county.sourceTypes.join(", ")}</td>
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

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Panel
            eyebrow="Search Health"
            title={liveJobs.length ? "Recent live jobs" : "Reference jobs from live review"}
            description={
              liveJobs.length
                ? "This panel is now reading the live SearchJob feed. It falls back to reference snapshots only when the app cannot reach Supabase."
                : "These are the runs that matter most as we keep tightening the frontend around the production workflow."
            }
          >
            <div className="space-y-3">
              {referenceJobs.map((job) => (
                <div key={job.id} className="brand-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">{job.title}</h3>
                      <p className="brand-copy-soft mt-1 text-sm">
                        {job.state} / {job.county} / {job.propertyType}
                      </p>
                    </div>
                    <StatusPill tone={job.status === "completed" ? "active" : job.status === "failed" ? "bad" : "neutral"} label={job.status} />
                  </div>
                  <div className="brand-copy-soft mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div>Range: <span className="tabular-nums">{job.dateRange}</span></div>
                    <div>Buyers: <span className="tabular-nums">{job.buyersFound}</span></div>
                    <div>Sales: <span className="tabular-nums">{job.salesAnalyzed}</span></div>
                  </div>
                  {job.notes ? <p className="brand-copy-muted mt-3 text-sm">{job.notes}</p> : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Operator Trail"
            title="Recent export activity"
            description="This keeps the operator artifact trail visible on the dashboard instead of forcing a jump into the dossier pages."
          >
            <div className="space-y-3">
              {recentExports.length ? (
                recentExports.map((record) => (
                  <div key={record.id} className="brand-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">{record.file_name}</div>
                        <div className="brand-copy-muted mt-1 font-mono text-xs">{record.search_job_id ?? "no search job id"}</div>
                      </div>
                      <StatusPill tone="good" label={`${record.row_count ?? 0} rows`} />
                    </div>
                    <div className="brand-copy-soft mt-3 text-sm">{record.storage_path}</div>
                    <div className="brand-copy-muted mt-2 text-xs">{new Date(record.created_at).toLocaleString()}</div>
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
      </div>

      <Panel
        eyebrow="Build Queue"
        title="Next implementation passes"
        description="This is the shortest path from the current repo to a genuinely usable Buyer Engine frontend."
      >
        <ol className="brand-copy-soft grid gap-3 text-sm leading-6 md:grid-cols-2">
          {pendingWork.map((item, index) => (
            <li key={item} className="brand-card grid grid-cols-[auto_1fr] gap-3 p-4">
              <span className="text-[hsl(38_92%_55%)]">{String(index + 1).padStart(2, "0")}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </BuyerShell>
  );
}
