import Link from "next/link";

import { BuyerShell, Metric, Panel, StatusPill } from "@/components/buyer-shell";
import {
  environmentReadiness,
  pendingWork,
  searchJobSnapshots,
} from "@/lib/buyer-engine-data";
import { getLiveCountyCapabilities } from "@/lib/buyer-engine-server";

export default async function Home() {
  const counties = await getLiveCountyCapabilities(true);
  const stats = {
    activeCountyCount: counties.filter((county) => county.status === "active").length,
    completedRuns: searchJobSnapshots.filter((job) => job.status === "completed").length,
    totalBuyers: searchJobSnapshots.reduce((sum, job) => sum + job.buyersFound, 0),
  };
  const approvedCounties = counties.filter((county) => county.status === "active" && county.supportsPast90Days);

  return (
    <BuyerShell
      eyebrow="Command Deck"
      title="Blackspire Buyer Engine Workspace"
      description="The frontend now has live search-job creation, workflow dispatch, a polling queue monitor, and buyer dossier rendering against the real Supabase project. What remains is refinement, not first-pass scaffolding."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Active Counties" value={String(stats.activeCountyCount)} detail="County source rows currently marked active" />
        <Metric label="Completed Reference Runs" value={String(stats.completedRuns)} detail="Useful baseline counties for frontend QA" />
        <Metric label="Visible Buyers" value={String(stats.totalBuyers)} detail="Sample count carried into the dashboard model" />
        <Metric label="Primary Risk" value="Wake timeout" detail="Pull Sales Data still hits the 60s task ceiling" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Reality Check"
          title="What changed in the repo"
          description="The repo is now operating as a real command surface. The work left is about stronger operator tooling and backend hardening."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Now in place</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
                <li>Real SearchJob inserts into Supabase</li>
                <li>Asynchronous n8n webhook dispatch after launch</li>
                <li>Search Jobs monitor with retry and highlight flow</li>
                <li>Buyer Reports route rendering live BuyerReport rows</li>
              </ul>
            </div>
            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Still missing</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
                <li>Supabase auth and user session flow</li>
                <li>Exports and AI outreach actions</li>
                <li>County risk controls for known timeout sources</li>
                <li>Realtime subscriptions in place of polling</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/searches/new"
              className="inline-flex border border-white/10 bg-[hsl(222_16%_8%)] px-4 py-3 text-sm text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
            >
              Launch a buyer sweep
            </Link>
            <Link
              href="/buyers"
              className="inline-flex border border-white/10 bg-[hsl(222_16%_8%)] px-4 py-3 text-sm text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
            >
              Review buyer dossiers
            </Link>
            <Link
              href="/searches"
              className="inline-flex border border-white/10 bg-[hsl(222_16%_8%)] px-4 py-3 text-sm text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
            >
              Watch the queue
            </Link>
          </div>
        </Panel>

        <Panel
          eyebrow="System Readiness"
          title="Environment contract"
          description="These values are now active in the repo. The remaining integration risk is around behavior, not missing configuration."
        >
          <div className="space-y-3">
            {environmentReadiness.map((item) => (
              <div key={item.key} className="grid gap-2 border border-white/10 bg-[hsl(222_14%_10%)] px-4 py-3 sm:grid-cols-[1fr_1.2fr_auto]">
                <div className="text-sm font-medium text-zinc-100">{item.key}</div>
                <div className="text-sm text-zinc-400">{item.purpose}</div>
                <div className="text-xs uppercase tracking-[0.24em] text-amber-300">{item.status}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          eyebrow="County Coverage"
          title="Live source network snapshot"
          description="The dashboard now shows the real county surface area we've already earned in the workflow layer."
        >
          <div className="overflow-hidden border border-white/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[hsl(222_16%_9%)] text-zinc-400">
                <tr>
                  <th className="border-b border-white/10 px-4 py-3 font-medium">County</th>
                  <th className="border-b border-white/10 px-4 py-3 font-medium">Source</th>
                  <th className="border-b border-white/10 px-4 py-3 font-medium">Date format</th>
                  <th className="border-b border-white/10 px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {approvedCounties.slice(0, 12).map((county) => (
                  <tr key={`${county.county}-${county.sourceTypes.join(",")}`} className="border-b border-white/5 bg-[hsl(222_14%_10%)] text-zinc-200">
                    <td className="px-4 py-3">
                      <div>{county.county}</div>
                      {county.notes[0] ? <div className="mt-1 text-xs text-zinc-500">{county.notes[0]}</div> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{county.sourceTypes.join(", ")}</td>
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
          title="Reference jobs from live review"
          description="These are the runs that matter most as we keep tightening the frontend around the production workflow."
        >
          <div className="space-y-3">
            {searchJobSnapshots.map((job) => (
              <div key={job.id} className="border border-white/10 bg-[hsl(222_14%_10%)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{job.title}</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      {job.state} / {job.county} / {job.propertyType}
                    </p>
                  </div>
                  <StatusPill tone={job.status === "completed" ? "active" : job.status === "failed" ? "bad" : "neutral"} label={job.status} />
                </div>
                <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-3">
                  <div>Range: <span className="tabular-nums">{job.dateRange}</span></div>
                  <div>Buyers: <span className="tabular-nums">{job.buyersFound}</span></div>
                  <div>Sales: <span className="tabular-nums">{job.salesAnalyzed}</span></div>
                </div>
                {job.notes ? <p className="mt-3 text-sm text-zinc-500">{job.notes}</p> : null}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Build Queue"
        title="Next implementation passes"
        description="This is the shortest path from the current repo to a genuinely usable Buyer Engine frontend."
      >
        <ol className="grid gap-3 text-sm leading-6 text-zinc-300 md:grid-cols-2">
          {pendingWork.map((item, index) => (
            <li key={item} className="grid grid-cols-[auto_1fr] gap-3 border border-white/10 bg-[hsl(222_14%_10%)] p-4">
              <span className="text-[hsl(38_92%_55%)]">{String(index + 1).padStart(2, "0")}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </BuyerShell>
  );
}
