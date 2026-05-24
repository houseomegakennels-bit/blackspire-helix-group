import { BuyerShell, Metric, Panel, StatusPill } from "@/components/buyer-shell";
import {
  getCountyVerificationTone,
  pendingWork,
  workflows,
} from "@/lib/buyer-engine-data";
import { getLiveCountyCapabilities } from "@/lib/buyer-engine-server";

const workflowTone = {
  "production-ready": "active",
  "stable-module": "good",
  "needs-finish": "warn",
  early: "neutral",
} as const;

export default async function WorkflowsPage() {
  const counties = await getLiveCountyCapabilities(true);
  const productionCount = workflows.filter((workflow) => workflow.status === "production-ready").length;
  const finishCount = workflows.filter((workflow) => workflow.status === "needs-finish").length;
  const approvedCount = counties.filter((county) => county.status === "active" && county.supportsPast90Days).length;
  const limitedCount = counties.filter((county) => county.status === "active" && !county.supportsPast90Days).length;
  const blockedCount = counties.filter((county) => county.status === "inactive").length + 1;
  const approvedCounties = counties.filter((county) => county.status === "active" && county.supportsPast90Days && county.county !== "Wake");
  const limitedCounties = counties.filter((county) => county.status === "active" && !county.supportsPast90Days);
  const blockedCounties = [
    ...counties.filter((county) => county.status === "inactive"),
    ...counties.filter((county) => county.county === "Wake"),
  ];

  return (
    <BuyerShell
      eyebrow="Operations"
      title="Workflow Fleet"
      description="This route keeps the live n8n picture visible inside the repo so frontend and automation work stay pointed at the same system."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="Live Workflows" value={String(workflows.length)} detail="Buyer Engine plus reusable media modules" />
        <Metric label="Production Ready" value={String(productionCount)} detail="Buyer Engine currently carries the real business value" />
        <Metric label="Needs Finish" value={String(finishCount)} detail="Video assembly and publishing remain the open flank" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Workflow Fleet"
          title="Current n8n posture"
          description="These rows reflect the live account review, not guessed statuses."
        >
          <div className="space-y-3">
            {workflows.map((workflow) => (
              <div key={workflow.workflowId} className="border border-white/10 bg-[hsl(222_14%_10%)] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-base font-semibold text-white">{workflow.name}</h3>
                      <StatusPill tone={workflowTone[workflow.status]} label={workflow.status.replace("-", " ")} />
                    </div>
                    <p className="text-sm leading-6 text-zinc-400">{workflow.summary}</p>
                  </div>
                  <dl className="min-w-72 space-y-1 text-sm text-zinc-400">
                    <div className="flex justify-between gap-4">
                      <dt>Workflow ID</dt>
                      <dd className="font-mono text-xs text-zinc-300">{workflow.workflowId}</dd>
                    </div>
                    {workflow.webhookPath ? (
                      <div className="flex justify-between gap-4">
                        <dt>Webhook</dt>
                        <dd className="font-mono text-xs text-zinc-300">{workflow.webhookPath}</dd>
                      </div>
                    ) : null}
                    {workflow.recentRuns ? (
                      <div className="flex justify-between gap-4">
                        <dt>Recent runs</dt>
                        <dd className="max-w-56 text-right text-xs text-zinc-300">{workflow.recentRuns}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Risk Register"
          title="County operating posture"
          description="This keeps source availability, 90-day readiness, and runtime blocks in one place."
        >
          <div className="space-y-3">
            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4 text-sm leading-6 text-zinc-300">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone="good" label={`${approvedCount} 90-day ready`} />
                <StatusPill tone="warn" label={`${limitedCount} historical / limited`} />
                <StatusPill tone="bad" label={`${blockedCount} blocked`} />
              </div>
              <p className="mt-3">
                The app now distinguishes between source availability and true past-90-day buyer readiness. Counties remain visible even when they are limited or blocked.
              </p>
            </div>
            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4 text-sm leading-6 text-zinc-300">
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Approved for 90-day sweeps</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {approvedCounties.slice(0, 14).map((county) => (
                  <StatusPill
                    key={county.county}
                    tone={getCountyVerificationTone(county.verificationStatus)}
                    label={county.county}
                  />
                ))}
              </div>
            </div>
            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4 text-sm leading-6 text-zinc-300">
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Visible but not approved for 90-day sweeps</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {limitedCounties.map((county) => (
                  <StatusPill key={county.county} tone="warn" label={county.county} />
                ))}
              </div>
              <p className="mt-3">
                These counties stay visible in the app, but their source shape is historical or too coarse for a true past-90-day buyer sweep.
              </p>
            </div>
            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4 text-sm leading-6 text-zinc-300">
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Blocked now</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {blockedCounties.map((county) => (
                  <StatusPill key={county.county} tone="bad" label={county.county === "Wake" ? "Wake runtime block" : county.county} />
                ))}
              </div>
              <p className="mt-3">
                Wake remains source-capable but is blocked operationally until the n8n timeout patch lands. Forsyth stays blocked because the public source does not expose the buyer data we need.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Open Work"
        title="Build queue"
        description="This is the direct handoff list between frontend and workflow work."
      >
        <ol className="space-y-3 text-sm leading-6 text-zinc-300">
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
