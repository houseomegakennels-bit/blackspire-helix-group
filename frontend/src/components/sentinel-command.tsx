"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type {
  SentinelInboxItem,
  SentinelWorkspaceSnapshot,
} from "@/lib/sentinel-server";

type TabId = "brief" | "deals" | "followups" | "feed" | "inbox" | "health";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "brief", label: "Morning Brief" },
  { id: "deals", label: "Deal Readiness" },
  { id: "followups", label: "Follow-Up Queue" },
  { id: "feed", label: "Opportunity Feed" },
  { id: "inbox", label: "Inbox" },
  { id: "health", label: "System Health" },
];

function readinessColor(category: string) {
  if (category === "Ready To Close") return "#34d399";
  if (category === "On Track") return "#2dd4bf";
  if (category === "Needs Attention") return "#fbbf24";
  return "#f87171";
}

function tierColor(tier: string) {
  if (tier === "Prime") return "#34d399";
  if (tier === "Strong") return "#2dd4bf";
  if (tier === "Watch") return "#fbbf24";
  return "#94a3b8";
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = readinessColor(label);
  return (
    <div
      className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border text-center"
      style={{ borderColor: color, boxShadow: `0 0 14px ${color}33` }}
    >
      <span className="text-lg font-black leading-none text-white">{score}</span>
      <span className="text-[8px] uppercase tracking-wider text-[var(--copy-muted)]">score</span>
    </div>
  );
}

export function SentinelCommand({ snapshot }: { snapshot: SentinelWorkspaceSnapshot }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("brief");
  const [inbox, setInbox] = useState<SentinelInboxItem[]>(snapshot.inbox);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkInboxAction(action: "resolve" | "archive") {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy("bulk");
    try {
      const response = await fetch("/api/sentinel/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const payload = (await response.json()) as { ok?: boolean };
      if (!response.ok || payload.ok === false) return;
      setInbox((prev) => prev.filter((item) => !selected.has(item.id)));
      setSelected(new Set());
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const brief = snapshot.brief;

  async function inboxAction(id: string, action: "read" | "resolve" | "archive") {
    setBusy(id);
    try {
      const response = await fetch("/api/sentinel/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const payload = (await response.json()) as { ok?: boolean };
      if (!response.ok || payload.ok === false) return;
      setInbox((prev) =>
        action === "read"
          ? prev.map((item) => (item.id === id ? { ...item, status: "read" } : item))
          : prev.filter((item) => item.id !== id),
      );
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.metrics.map((metric) => (
          <div key={metric.label} className="brand-panel p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{metric.label}</div>
            <div className="mt-3 text-3xl font-black tracking-[0.06em] text-white">{metric.value}</div>
            <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{metric.detail}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="whitespace-nowrap rounded-full border px-4 py-2 text-xs uppercase tracking-[0.22em] transition"
              style={
                isActive
                  ? { borderColor: "#2dd4bf", color: "#5eead4", background: "rgba(45,212,191,0.12)" }
                  : { borderColor: "var(--line)", color: "white", background: "rgba(0,0,0,0.24)" }
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* MORNING BRIEF */}
      {activeTab === "brief" ? (
        <div className="space-y-5">
          <div className="brand-panel p-6 lg:p-7">
            <div className="text-[10px] uppercase tracking-[0.4em] text-[#5eead4]">Sentinel Morning Brief</div>
            <h2 className="mt-2 text-2xl font-black tracking-[0.04em] text-white sm:text-3xl">{brief.greeting}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">{brief.narrative}</p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#2dd4bf55] bg-[rgba(45,212,191,0.08)] px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-[#5eead4]">
              {brief.criticalCount} critical item{brief.criticalCount === 1 ? "" : "s"} ·
              Projected ${brief.projectedOpportunityValue.toLocaleString()}
            </div>
          </div>

          {brief.criticalItems.length ? (
            <div className="brand-panel p-6">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Needs Attention</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {brief.criticalItems.map((item) => (
                  <Link
                    key={`${item.type}-${item.dealId}`}
                    href={`/workspace/deal-engine/${item.dealId}`}
                    className="flex items-center justify-between rounded-[16px] border p-4 transition hover:bg-white/5"
                    style={{ borderColor: item.severity === "critical" ? "#f8717155" : "#fbbf2455" }}
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{item.label}</div>
                      <div className="mt-1 text-xs text-[var(--copy-soft)]">{item.address}</div>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider"
                      style={{
                        color: item.severity === "critical" ? "#fca5a5" : "#fcd34d",
                        background: item.severity === "critical" ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)",
                      }}
                    >
                      {item.dueLabel ?? item.severity}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="brand-panel p-6">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Top Priority Deals</div>
              <div className="mt-4 space-y-3">
                {brief.topPriorityDeals.length ? (
                  brief.topPriorityDeals.map((deal) => (
                    <Link
                      key={deal.dealId}
                      href={`/workspace/deal-engine/${deal.dealId}`}
                      className="flex items-center gap-4 rounded-[16px] border border-[var(--line)] p-3 transition hover:bg-white/5"
                    >
                      <ScoreRing score={deal.readinessScore} label={deal.category} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{deal.rank}. {deal.address}</div>
                        <div className="mt-1 text-xs" style={{ color: readinessColor(deal.category) }}>{deal.category}</div>
                        <div className="mt-1 truncate text-xs text-[var(--copy-soft)]">{deal.reason}</div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="text-sm text-[var(--copy-soft)]">No active deals yet. Promote a Harvester or Seller opportunity into the Deal Engine.</div>
                )}
              </div>
            </div>

            <div className="brand-panel p-6">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Recommended Priorities</div>
              <ol className="mt-4 space-y-2">
                {brief.recommendedPriorities.length ? (
                  brief.recommendedPriorities.map((priority, index) => (
                    <li key={index} className="flex gap-3 text-sm leading-6 text-[var(--copy-soft)]">
                      <span className="text-[#5eead4]">{index + 1}.</span>
                      <span>{priority}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-[var(--copy-soft)]">All clear — no urgent priorities flagged.</li>
                )}
              </ol>
              {brief.highValueOpportunities.length ? (
                <div className="mt-5 border-t border-[var(--line)] pt-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-[var(--copy-muted)]">High-Value Opportunities</div>
                  <div className="mt-3 space-y-2">
                    {brief.highValueOpportunities.map((opp, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span className="truncate text-white">{opp.title}</span>
                        <span className="text-[#5eead4]">{opp.opportunityScore}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* DEAL READINESS */}
      {activeTab === "deals" ? (
        <div className="space-y-3">
          {snapshot.deals.length ? (
            snapshot.deals.map((deal) => (
              <div key={deal.dealId} className="brand-panel p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <ScoreRing score={deal.readiness.score} label={deal.readiness.category} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <Link href={`/workspace/deal-engine/${deal.dealId}`} className="truncate text-base font-semibold text-white hover:underline">
                        {deal.propertyAddress}
                      </Link>
                      <span className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: readinessColor(deal.readiness.category), background: `${readinessColor(deal.readiness.category)}1f` }}>
                        {deal.readiness.category}
                      </span>
                      {deal.propertyId ? (
                        <Link href={`/workspace/property/${deal.propertyId}`} className="text-[10px] uppercase tracking-wider text-[#5eead4] hover:underline">
                          Property →
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-[var(--copy-soft)]">{deal.ownerName} · {deal.county} · {deal.status}{deal.expectedRevenue ? ` · $${deal.expectedRevenue.toLocaleString()} expected` : deal.potentialValue ? ` · ~$${deal.potentialValue.toLocaleString()} potential` : ""}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {deal.readiness.factors.map((factor) => (
                        <span
                          key={factor.key}
                          className="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider"
                          style={{
                            borderColor: factor.met ? "#2dd4bf55" : "var(--line)",
                            color: factor.met ? "#5eead4" : "var(--copy-muted)",
                          }}
                          title={factor.detail ?? ""}
                        >
                          {factor.met ? "✓" : "○"} {factor.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="brand-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">No active deals in the Deal Engine yet.</div>
          )}
        </div>
      ) : null}

      {/* FOLLOW-UP QUEUE */}
      {activeTab === "followups" ? (
        <div className="space-y-3">
          {snapshot.followUps.length ? (
            snapshot.followUps.map((item) => (
              <div key={item.id} className="brand-panel flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[rgba(45,212,191,0.12)] px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-[#5eead4]">
                      {item.target.replaceAll("_", " ")}
                    </span>
                    <span className="text-sm font-semibold text-white">{item.who}</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--copy-soft)]">{item.why}</div>
                  <div className="mt-2 rounded-[12px] border border-[var(--line)] bg-black/20 p-3 text-sm leading-6 text-[var(--copy-soft)]">
                    {item.recommendedMessage}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-2xl font-black text-white">{item.priority}</span>
                  {item.deadline ? <span className="text-[10px] uppercase tracking-wider text-[#fcd34d]">{item.deadline}</span> : null}
                  <Link href={item.href} className="harvester-mini-link">Open</Link>
                </div>
              </div>
            ))
          ) : (
            <div className="brand-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">Nothing in the follow-up queue right now.</div>
          )}
        </div>
      ) : null}

      {/* OPPORTUNITY FEED */}
      {activeTab === "feed" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {snapshot.feed.length ? (
            snapshot.feed.map((opp) => (
              <Link key={opp.id} href={opp.href} className="brand-panel p-5 transition hover:bg-white/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{opp.title}</div>
                    <div className="mt-1 truncate text-xs text-[var(--copy-soft)]">{opp.subtitle}</div>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider" style={{ color: tierColor(opp.tier), background: `${tierColor(opp.tier)}1f` }}>
                    {opp.tier} · {opp.opportunityScore}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="uppercase tracking-wider text-[var(--copy-muted)]">{opp.source} · {opp.kind.replaceAll("_", " ")}</span>
                  {opp.potentialAssignmentValue ? <span className="text-[#5eead4]">~${opp.potentialAssignmentValue.toLocaleString()}</span> : null}
                </div>
                <div className="mt-2 text-xs text-[var(--copy-soft)]">→ {opp.recommendedAction}</div>
              </Link>
            ))
          ) : (
            <div className="brand-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">No scored opportunities yet.</div>
          )}
        </div>
      ) : null}

      {/* INBOX */}
      {activeTab === "inbox" ? (
        <div className="space-y-3">
          {inbox.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--line)] bg-black/20 px-4 py-2">
              <button
                type="button"
                onClick={() => setSelected((prev) => (prev.size === inbox.length ? new Set() : new Set(inbox.map((i) => i.id))))}
                className="text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] hover:text-white"
              >
                {selected.size === inbox.length && inbox.length ? "Clear all" : "Select all"}
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--copy-muted)]">{selected.size} selected</span>
                <button type="button" disabled={!selected.size || busy === "bulk"} onClick={() => bulkInboxAction("resolve")} className="harvester-mini-link disabled:opacity-40">Resolve selected</button>
                <button type="button" disabled={!selected.size || busy === "bulk"} onClick={() => bulkInboxAction("archive")} className="harvester-action-button--danger rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-wider disabled:opacity-40">Archive selected</button>
              </div>
            </div>
          ) : null}
          {inbox.length ? (
            inbox.map((item) => (
              <div
                key={item.id}
                className="brand-panel flex flex-wrap items-start justify-between gap-4 p-5"
                style={{ opacity: item.status === "read" ? 0.7 : 1 }}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#2dd4bf]"
                    aria-label="Select inbox item"
                  />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{
                        color: item.severity === "critical" ? "#fca5a5" : item.severity === "warning" ? "#fcd34d" : "#5eead4",
                        background: item.severity === "critical" ? "rgba(248,113,113,0.12)" : item.severity === "warning" ? "rgba(251,191,36,0.12)" : "rgba(45,212,191,0.12)",
                      }}
                    >
                      {item.category.replaceAll("_", " ")}
                    </span>
                    {item.status === "unread" ? <span className="h-2 w-2 rounded-full bg-[#2dd4bf]" /> : null}
                    <span className="text-sm font-semibold text-white">{item.title}</span>
                  </div>
                  {item.body ? <div className="mt-1 text-xs text-[var(--copy-soft)]">{item.body}</div> : null}
                  {item.recommendedAction ? <div className="mt-2 text-xs text-[#5eead4]">→ {item.recommendedAction}</div> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.linkHref ? <Link href={item.linkHref} className="harvester-mini-link">Open</Link> : null}
                  {item.status === "unread" ? (
                    <button type="button" disabled={busy === item.id} onClick={() => inboxAction(item.id, "read")} className="harvester-mini-link">Mark read</button>
                  ) : null}
                  <button type="button" disabled={busy === item.id} onClick={() => inboxAction(item.id, "resolve")} className="harvester-mini-link">Resolve</button>
                  <button type="button" disabled={busy === item.id} onClick={() => inboxAction(item.id, "archive")} className="harvester-action-button--danger rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-wider">Archive</button>
                </div>
              </div>
            ))
          ) : (
            <div className="brand-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">Inbox zero — nothing needs your attention.</div>
          )}
        </div>
      ) : null}

      {/* SYSTEM HEALTH (pipeline leak + missing-X) */}
      {activeTab === "health" ? (
        <div className="space-y-6">
          <div className="brand-panel p-6">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Pipeline</div>
            {snapshot.pipelineLeak.biggestLeak ? (
              <div className="mt-2 text-xs text-[#fcd34d]">
                Biggest leak: {snapshot.pipelineLeak.biggestLeak.dropPct}% drop from {snapshot.pipelineLeak.biggestLeak.from} → {snapshot.pipelineLeak.biggestLeak.to}
              </div>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {snapshot.pipelineLeak.stages.map((stage) => (
                <div key={stage.stage} className="rounded-[14px] border border-[var(--line)] p-3 text-center">
                  <div className="text-2xl font-black text-white">{stage.count}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--copy-muted)]">{stage.stage}</div>
                  {stage.conversionFromPrev != null ? (
                    <div className="mt-1 text-[10px]" style={{ color: stage.conversionFromPrev >= 50 ? "#34d399" : stage.conversionFromPrev >= 25 ? "#fbbf24" : "#f87171" }}>
                      {stage.conversionFromPrev}% ↓
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Deals missing buyers", value: snapshot.systemHealth.dealsMissingBuyers },
              { label: "Deals missing EMD", value: snapshot.systemHealth.dealsMissingEmd },
              { label: "Deals missing signatures", value: snapshot.systemHealth.dealsMissingSignatures },
              { label: "Deals missing title", value: snapshot.systemHealth.dealsMissingTitle },
              { label: "Stale opportunities", value: snapshot.systemHealth.staleOpportunities },
              { label: "Duplicate properties", value: snapshot.duplicateWarnings.duplicateProperties },
              { label: "Duplicate owners", value: snapshot.duplicateWarnings.duplicateOwners },
            ].map((item) => (
              <div key={item.label} className="brand-panel p-5">
                <div className="text-3xl font-black" style={{ color: item.value > 0 ? "#f87171" : "#34d399" }}>{item.value}</div>
                <div className="mt-1 text-sm text-[var(--copy-soft)]">{item.label}</div>
              </div>
            ))}
            <div className="brand-panel p-5" style={{ borderColor: "#f8717155" }}>
              <div className="text-3xl font-black text-[#fca5a5]">${Math.round(snapshot.systemHealth.revenueAtRisk / 1000)}k</div>
              <div className="mt-1 text-sm text-[var(--copy-soft)]">Revenue at risk</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
