import { notFound } from "next/navigation";
import Link from "next/link";

import { getPropertyCommandView } from "@/lib/property-server";
import {
  readinessColor,
  opportunityTierColor,
} from "@/lib/sentinel-display";

export const dynamic = "force-dynamic";

function healthColor(category: string) {
  if (category === "Healthy") return "#34d399";
  if (category === "Stable") return "#2dd4bf";
  if (category === "Developing") return "#fbbf24";
  return "#94a3b8";
}

function ScoreCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="brand-panel p-5" style={{ borderColor: `${color}55` }}>
      <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{label}</div>
      <div className="mt-2 text-3xl font-black" style={{ color }}>{value}</div>
      <div className="mt-1 text-xs text-[var(--copy-soft)]">{sub}</div>
    </div>
  );
}

export default async function PropertyCommandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getPropertyCommandView(id);
  if (!view) notFound();

  const flags = [
    view.property.vacant && "Vacant",
    view.property.taxDelinquent && "Tax delinquent",
    view.property.foreclosure && "Foreclosure",
    view.property.probate && "Probate",
    view.property.codeViolation && "Code violation",
  ].filter(Boolean) as string[];

  const quickActions = [
    { label: "Call / Contact Seller", href: view.related.sellerLeadId ? "/workspace/nexus" : "/workspace/harvester" },
    { label: view.deal ? "Open Deal" : "Create Deal", href: view.deal ? `/workspace/deal-engine/${view.deal.dealId}` : "/workspace/deal-engine" },
    { label: "Find Buyers", href: "#buyers" },
    { label: "Open Contract", href: view.deal ? `/workspace/deal-engine/${view.deal.dealId}` : "#" },
    { label: "Open Title", href: view.deal ? `/workspace/deal-engine/${view.deal.dealId}` : "#" },
    { label: "View in Sentinel", href: "/workspace/sentinel" },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.1),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[1320px] px-4 py-8 lg:px-6 lg:py-10 space-y-6">
        {/* Header + Next Best Action */}
        <div className="brand-panel p-6 lg:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.4em] text-[#5eead4]">Property Command</div>
              <h1 className="mt-2 text-3xl font-black tracking-[0.04em] text-white sm:text-4xl">{view.property.address}</h1>
              <p className="mt-2 text-sm text-[var(--copy-soft)]">
                {[view.property.city, view.property.county && `${view.property.county} County`, view.property.state, view.property.zip].filter(Boolean).join(" · ")}
              </p>
              {flags.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {flags.map((flag) => (
                    <span key={flag} className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-wider text-amber-200">{flag}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <Link
              href={view.nextBestAction.href}
              className="shrink-0 rounded-[18px] border border-[#2dd4bf] bg-[rgba(45,212,191,0.12)] px-6 py-4 text-center transition hover:bg-[rgba(45,212,191,0.2)]"
            >
              <div className="text-[10px] uppercase tracking-[0.28em] text-[#5eead4]">Next Best Action</div>
              <div className="mt-1 text-lg font-bold text-white">{view.nextBestAction.label}</div>
              <div className="mt-1 max-w-[240px] text-xs text-[var(--copy-soft)]">{view.nextBestAction.reason}</div>
            </Link>
          </div>
        </div>

        {/* Scores + Revenue */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ScoreCard label="Opportunity Score™" value={String(view.scores.opportunity.score)} sub={view.scores.opportunity.tier} color={opportunityTierColor(view.scores.opportunity.tier)} />
          <ScoreCard label="Deal Readiness" value={view.scores.dealReadiness != null ? String(view.scores.dealReadiness) : "—"} sub={view.scores.dealReadinessCategory ?? "No deal yet"} color={view.scores.dealReadinessCategory ? readinessColor(view.scores.dealReadinessCategory as never) : "#94a3b8"} />
          <ScoreCard label="Property Health" value={String(view.scores.propertyHealth.score)} sub={view.scores.propertyHealth.category} color={healthColor(view.scores.propertyHealth.category)} />
          <ScoreCard label="Expected Revenue" value={view.expectedRevenue != null ? `$${view.expectedRevenue.toLocaleString()}` : "—"} sub={view.potentialAssignmentValue ? `of $${view.potentialAssignmentValue.toLocaleString()} potential` : "potential unknown"} color="#d6a84f" />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Link key={action.label} href={action.href} className="rounded-full border border-[var(--line)] bg-black/30 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white transition hover:border-[#2dd4bf] hover:text-[#5eead4]">
              {action.label}
            </Link>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Left: property + seller + owner */}
          <div className="space-y-6">
            <div className="brand-panel p-6">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Property</div>
              <dl className="mt-4 space-y-2 text-sm">
                {[
                  ["Type", view.property.propertyType ?? "Unknown"],
                  ["Assessed value", view.property.assessedValue != null ? `$${view.property.assessedValue.toLocaleString()}` : "Unknown"],
                  ["Estimated equity", view.property.estimatedEquity != null ? `$${view.property.estimatedEquity.toLocaleString()}` : "Unknown"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-[var(--line)] pb-2">
                    <dt className="text-[var(--copy-muted)]">{k}</dt>
                    <dd className="text-right text-white">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="brand-panel p-6">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Seller & Owner</div>
              <dl className="mt-4 space-y-2 text-sm">
                {[
                  ["Owner", view.owner?.name ?? "Unknown"],
                  ["Mailing", view.owner?.mailingAddress ?? "Unknown"],
                  ["Seller status", view.seller?.status ?? "No seller lead"],
                  ["Motivation", view.seller ? String(view.seller.motivationScore) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-[var(--line)] pb-2">
                    <dt className="text-[var(--copy-muted)]">{k}</dt>
                    <dd className="text-right text-white">{v}</dd>
                  </div>
                ))}
              </dl>
              {view.seller?.recommendedAction ? (
                <div className="mt-3 text-xs text-[#5eead4]">→ {view.seller.recommendedAction}</div>
              ) : null}
            </div>
          </div>

          {/* Right: buyers + related */}
          <div className="space-y-6">
            <div id="buyers" className="brand-panel p-6">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Buyer Matches</div>
                <span className="rounded-full px-3 py-1 text-[10px] uppercase tracking-wider" style={{ color: view.buyers.assignmentPotential === "high" ? "#34d399" : view.buyers.assignmentPotential === "medium" ? "#fbbf24" : "#94a3b8", background: "rgba(45,212,191,0.1)" }}>
                  {view.buyers.buyerCount} buyers · {view.buyers.assignmentPotential} demand
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {view.buyers.matches.length ? (
                  view.buyers.matches.slice(0, 6).map((buyer) => (
                    <div key={buyer.buyerId} className="rounded-[14px] border border-[var(--line)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-white">{buyer.buyerName}</span>
                        <span className="shrink-0 text-sm font-bold text-[#5eead4]">{buyer.matchScore}</span>
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--copy-muted)]">{buyer.buyerType.replaceAll("_", " ")}</div>
                      {buyer.reasons.length ? <div className="mt-1 text-xs text-[var(--copy-soft)]">{buyer.reasons.slice(0, 2).join(" · ")}</div> : null}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[var(--copy-soft)]">No buyers indexed for {view.property.county ?? "this county"} yet. Launch a Buyer Engine search to ingest them.</div>
                )}
              </div>
            </div>

            <div className="brand-panel p-6">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Related Records</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Seller Lead", href: view.related.sellerLeadId ? "/seller-engine" : null, ok: Boolean(view.related.sellerLeadId) },
                  { label: "Deal", href: view.related.dealId ? `/workspace/deal-engine/${view.related.dealId}` : null, ok: Boolean(view.related.dealId) },
                  { label: "Buyers", href: "#buyers", ok: view.related.buyerCount > 0 },
                  { label: "Contract", href: view.related.dealId ? `/workspace/deal-engine/${view.related.dealId}` : null, ok: view.related.hasContract },
                  { label: "Transaction", href: view.related.dealId ? `/workspace/deal-engine/${view.related.dealId}` : null, ok: view.related.hasTransaction },
                  { label: "Sentinel", href: "/workspace/sentinel", ok: true },
                ].map((rec) =>
                  rec.href ? (
                    <Link key={rec.label} href={rec.href} className="rounded-[12px] border border-[var(--line)] p-3 text-center text-xs transition hover:border-[#2dd4bf]">
                      <div className="text-white">{rec.label}</div>
                      <div className="mt-1 text-[10px]" style={{ color: rec.ok ? "#34d399" : "#94a3b8" }}>{rec.ok ? "linked" : "—"}</div>
                    </Link>
                  ) : (
                    <div key={rec.label} className="rounded-[12px] border border-[var(--line)] p-3 text-center text-xs opacity-50">
                      <div className="text-white">{rec.label}</div>
                      <div className="mt-1 text-[10px] text-[var(--copy-muted)]">none</div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div id="timeline" className="brand-panel p-6">
          <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Activity Timeline</div>
          <div className="mt-4 space-y-3">
            {view.timeline.length ? (
              view.timeline.map((event, index) => (
                <div key={index} className="flex gap-3 text-sm">
                  <span className="w-28 shrink-0 text-xs text-[var(--copy-muted)]">{new Date(event.at).toLocaleDateString()}</span>
                  <span className="h-2 w-2 shrink-0 translate-y-1.5 rounded-full bg-[#2dd4bf]" />
                  <span className="text-[var(--copy-soft)]">{event.label}</span>
                </div>
              ))
            ) : (
              <div className="text-sm text-[var(--copy-soft)]">No recorded activity yet.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
