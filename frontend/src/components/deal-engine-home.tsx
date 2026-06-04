import { DealEngineActions } from "@/components/deal-engine-actions";
import Link from "next/link";

import { DealEngineShell } from "@/components/deal-engine-shell";
import { Metric, Panel, StatusPill } from "@/components/buyer-shell";
import {
  dealEngineFlow,
  dealEngineModules,
} from "@/lib/deal-engine";
import type { DealEngineWorkspaceSnapshot } from "@/lib/deal-engine-server";

function statusTone(status: string) {
  if (status === "Negotiating") return "warn";
  if (status === "Offer Ready" || status === "Under Contract") return "good";
  return "neutral";
}

export function DealEngineHome({ snapshot }: { snapshot: DealEngineWorkspaceSnapshot }) {
  return (
    <DealEngineShell>
      <header className="brand-panel overflow-hidden px-6 py-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[38%] bg-[radial-gradient(circle_at_center,hsl(193_100%_60%/.08),transparent_72%)]" />
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="relative space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Wholesale Command Deck</p>
              <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                The Helix workspace where qualified leads become real deals.
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                Blackspire Deal Engine is the bridge between Seller Engine intelligence and Buyer
                Engine activation: underwriting, acquisition, negotiation tracking, contracts, and
                disposition packaging all live here.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/seller-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Review seller pipeline
              </Link>
              <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Open buyer workspace
              </Link>
              <Link href="/ecosystem/deal-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Public division page
              </Link>
            </div>
          </div>

          <div className="relative grid gap-4 content-start">
            <div className="brand-card overflow-hidden p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--gold-soft)]">
                    Helix flow
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white">Seller to buyer relay</div>
                </div>
                <StatusPill tone={snapshot.usingFallback ? "warn" : "good"} label={snapshot.usingFallback ? "fallback mode" : "live mode"} />
              </div>
              <div className="mt-5 space-y-3">
                {snapshot.heroSignals.map((signal) => (
                  <div
                    key={signal}
                    className="flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]"
                  >
                    <span className="h-2 w-2 rounded-full bg-[hsl(193_100%_60%)] shadow-[0_0_14px_hsl(193_100%_60%/.4)]" />
                    <span>{signal}</span>
                  </div>
                ))}
                {dealEngineFlow.map((step) => (
                  <Link
                    key={step.label}
                    href={step.href}
                    className="block rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-4 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                  >
                    <div className="text-base font-semibold text-white">{step.label}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{step.detail}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        {snapshot.metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
        ))}
      </section>

      <Panel
        eyebrow="Action Console"
        title="Push the deal forward"
        description="Move a seller lead into Deal Engine, save contract posture, and generate buyer outreach drafts without leaving the Helix command surface."
      >
        <DealEngineActions
          sellerSignals={snapshot.sellerSignals}
          buyerSignals={snapshot.buyerSignals}
          contractDrafts={snapshot.contractDrafts}
        />
      </Panel>

      <Panel
        eyebrow="Pipeline Board"
        title="Stage-by-stage deal movement"
        description="This is the operator view of where every active opportunity sits right now, from fresh intake through investor follow-up."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {snapshot.stageBoard.map((lane) => (
            <div key={lane.label} className="brand-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{lane.label}</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{lane.detail}</div>
                </div>
                <StatusPill
                  tone={lane.count ? "good" : "neutral"}
                  label={String(lane.count).padStart(2, "0")}
                />
              </div>
              <div className="mt-4 space-y-3">
                {lane.deals.length ? (
                  lane.deals.slice(0, 3).map((lead) => (
                    <Link
                      key={lead.id}
                      href={`/workspace/deal-engine/${encodeURIComponent(lead.id)}`}
                      className="block rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                    >
                      <div className="text-sm font-semibold text-white">{lead.propertyAddress}</div>
                      <div className="mt-1 text-xs text-[var(--copy-muted)]">
                        {lead.id} / {lead.status}
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                    No deals are parked in this lane yet.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
        <Panel
          eyebrow="Pipeline"
          title="Flagship deal queue"
          description="These leads represent the kind of seller-qualified opportunities the command center is designed to shape into disposition-ready packages."
        >
          <div className="space-y-4">
            {snapshot.leads.map((lead) => (
              <div key={lead.id} className="brand-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{lead.id}</div>
                    <h3 className="mt-2 text-xl font-semibold text-white">{lead.propertyAddress}</h3>
                    <p className="mt-1 text-sm text-[var(--copy-soft)]">{lead.ownerName} / {lead.county} County</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={statusTone(lead.status)} label={lead.status.toLowerCase()} />
                    <StatusPill tone="good" label={`score ${lead.motivationScore}`} />
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">MAO</div>
                    <div className="mt-2 text-xl font-semibold text-white">{lead.mao}</div>
                  </div>
                  <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Assignment fee</div>
                    <div className="mt-2 text-xl font-semibold text-white">{lead.assignmentFee}</div>
                  </div>
                  <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Exit strategy</div>
                    <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{lead.exitStrategy}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Next action</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{lead.nextAction}</div>
                </div>
                <div className="mt-4">
                  <Link
                    href={`/workspace/deal-engine/${encodeURIComponent(lead.id)}`}
                    className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition"
                  >
                    Open deal workstation
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Modules"
          title="What this system owns"
          description="Deal Engine is not just analysis. It is the operational layer that moves a lead toward contract and buyer activation."
        >
          <div className="space-y-4">
            <div className="brand-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Integration posture</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    The Helix workspace now reads the standalone Deal Engine schema when server
                    credentials are present, and gracefully falls back to brand-approved flagship
                    examples when they are not.
                  </div>
                </div>
                <StatusPill tone={snapshot.env.enabled ? "good" : "warn"} label={snapshot.env.enabled ? "supabase ready" : "env incomplete"} />
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                  {snapshot.env.enabled
                    ? "Live reads are enabled for deal_leads, deal_analysis, seller_conversations, and buyer_matches."
                    : `Missing env: ${snapshot.env.missing.join(", ")}`}
                </div>
              </div>
            </div>
            {dealEngineModules.map((module) => (
              <div key={module.title} className="brand-card p-5">
                <div className="text-lg font-semibold text-white">{module.title}</div>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--copy-soft)]">
                  {module.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[hsl(193_100%_60%)]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Seller Inputs"
          title="Seller Engine handoff intelligence"
          description="These are the upstream seller outputs Deal Engine can now read directly when assembling deal posture, negotiation framing, and acquisition priorities."
        >
          <div className="space-y-4">
            {snapshot.sellerSignals.map((signal) => (
              <div key={signal.id} className="brand-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{signal.sourceName}</div>
                    <div className="mt-2 text-lg font-semibold text-white">{signal.propertyAddress}</div>
                    <div className="mt-1 text-sm text-[var(--copy-soft)]">{signal.ownerName} / {signal.county} County</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone="good" label={`score ${signal.score}`} />
                    <StatusPill tone={signal.status === "Sent to Deal Engine" ? "active" : "warn"} label={signal.status.toLowerCase()} />
                  </div>
                </div>
                <div className="mt-4 text-sm leading-6 text-[var(--copy-soft)]">{signal.summary}</div>
                <div className="mt-4 rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Handoff action</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{signal.recommendedAction}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Buyer Inputs"
          title="Buyer Engine activation signals"
          description="These are the downstream buyer outputs Deal Engine can use for packaging, buyer matching, and outreach-ready disposition decisions."
        >
          <div className="space-y-4">
            {snapshot.buyerSignals.map((signal) => (
              <div key={signal.id} className="brand-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{signal.market}</div>
                    <div className="mt-2 text-lg font-semibold text-white">{signal.buyerName}</div>
                    <div className="mt-1 text-sm text-[var(--copy-soft)]">{signal.propertyType} / search {signal.searchJobId}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone="good" label={`score ${signal.score}`} />
                    <StatusPill tone="warn" label={`${signal.purchaseCount} buys`} />
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Visible spend</div>
                    <div className="mt-2 text-xl font-semibold text-white">{signal.totalSpend}</div>
                  </div>
                  <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Draft subject</div>
                    <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{signal.outreachSubject}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Disposition angle</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{signal.outreachAngle}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Assembly"
        title="Contract and outreach workbench"
        description="This is the synthesis layer: Deal Engine can now read seller context and buyer momentum together, then turn that into contract-ready posture and outreach sequencing."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {snapshot.contractDrafts.map((draft) => (
            <div key={draft.dealId} className="brand-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{draft.dealId}</div>
                  <div className="mt-2 text-xl font-semibold text-white">{draft.propertyAddress}</div>
                  <div className="mt-1 text-sm text-[var(--copy-soft)]">{draft.sellerName}</div>
                </div>
                <StatusPill tone="good" label={draft.contractType.toLowerCase()} />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Offer window</div>
                  <div className="mt-2 text-xl font-semibold text-white">{draft.offerWindow}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Earnest money</div>
                  <div className="mt-2 text-xl font-semibold text-white">{draft.earnestMoney}</div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Seller outreach lead</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{draft.outreachLead}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Buyer disposition note</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{draft.buyerDispositionNote}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Next steps</div>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--copy-soft)]">
                    {draft.nextSteps.map((step) => (
                      <li key={step} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </DealEngineShell>
  );
}
