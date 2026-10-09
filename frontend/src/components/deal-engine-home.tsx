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
  const activeDeals = snapshot.leads.filter((lead) => !/^(closed|dead|lost)(?:\b|$)/i.test(lead.status));
  const pagination = snapshot.pagination;
  const pageCount = pagination?.total != null ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const listUnavailable = pagination?.available === false;
  const hasLiveDeals = snapshot.leads.length > 0;
  const hasSellerSignals = snapshot.sellerSignals.length > 0;
  const hasBuyerSignals = snapshot.buyerSignals.length > 0;
  const hasContractDrafts = snapshot.contractDrafts.length > 0;
  const persistenceTone =
    snapshot.persistence.mode === "live"
      ? "good"
      : snapshot.persistence.mode === "schema-missing"
        ? "warn"
        : "warn";
  const persistenceLabel =
    snapshot.persistence.mode === "live"
      ? "persistence live"
      : snapshot.persistence.mode === "schema-missing"
        ? "schema missing"
        : "env incomplete";

  return (
    <DealEngineShell>
      <header className="brand-panel px-6 py-7">
        <h2 className="brand-display text-4xl leading-tight text-white lg:text-5xl">Your property workspace.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">Add a property or pick up an existing deal. Each property keeps its numbers, offer terms and next steps together.</p>
        <div className="workspace-actions mt-5 flex flex-wrap gap-3">
          <Link href="/workspace/harvester" className="workspace-primary brand-button inline-flex px-5 py-3 text-sm">Add property</Link>
          {hasLiveDeals ? <a href="#continue-working" className="brand-button inline-flex px-5 py-3 text-sm">Continue working</a> : <Link href="/seller-engine" className="brand-button inline-flex px-5 py-3 text-sm">Review seller leads</Link>}
        </div>
        <p className="mt-3 text-sm text-[var(--copy-soft)]">New properties start in intake, then move through seller qualification into this workspace.</p>
      </header>

      <section id="continue-working" aria-labelledby="continue-heading" className="workspace-continue space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="continue-heading" className="text-2xl font-semibold text-white">Continue working</h2>
          {hasLiveDeals ? <a href="#property-queue" className="brand-button inline-flex px-4 py-3 text-sm">Browse properties{pagination?.total != null ? ` (${pagination.total})` : ""}</a> : null}
        </div>
        {activeDeals.length ? <div className="grid gap-4 xl:grid-cols-3">
          {activeDeals.slice(0, 3).map((lead) => <article key={lead.id} className="brand-card flex min-w-0 flex-col gap-3 p-5">
            <StatusPill tone={statusTone(lead.status)} label={lead.status} />
            <h3 className="text-lg font-semibold text-white">{lead.propertyAddress}</h3>
            <p className="text-sm leading-6 text-[var(--copy-soft)]"><span className="font-semibold text-white">Next step: </span>{lead.nextAction || "Open this property to review the details and choose a next step."}</p>
            <Link href={`/workspace/deal-engine/${encodeURIComponent(lead.id)}`} className="brand-button mt-auto inline-flex px-4 py-3 text-sm" aria-label={`Continue working on ${lead.propertyAddress}`}>Open property</Link>
          </article>)}
        </div> : <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">{listUnavailable ? "The property list could not be loaded. Refresh the page to try again; your saved properties have not been removed." : hasLiveDeals ? "No active properties on this page. Browse the property list below to review other pages or completed deals." : "Your first property will appear here after seller qualification. Start with Add property, or review existing seller leads."}</div>}
      </section>

      <section aria-label="Property metrics for this page" className="grid gap-4 md:grid-cols-4">
        <p className="md:col-span-4 text-sm text-[var(--copy-soft)]">Overview of properties on this page</p>
        {snapshot.metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
        ))}
      </section>

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

      <div id="property-queue" className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
        <Panel
          eyebrow="Pipeline"
          title="Your properties"
          description="Browse saved properties and open one to continue working. Figures and stage counts above reflect the current page."
        >
          {pagination?.available ? <nav aria-label="Property pages" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[var(--copy-soft)]">
            <span>Page {pagination.page} of {pageCount} · {pagination.total} properties</span>
            {pagination.page > 1 ? <Link href={`/workspace/deal-engine?page=${pagination.page - 1}#property-queue`} className="brand-button inline-flex px-4 py-3">Previous page</Link> : null}
            {pagination.page < pageCount ? <Link href={`/workspace/deal-engine?page=${pagination.page + 1}#property-queue`} className="brand-button inline-flex px-4 py-3">Next page</Link> : null}
          </nav> : null}
          {hasLiveDeals ? (
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
          ) : (
            <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
              <p>{listUnavailable ? "The property list is unavailable. Refresh to try again." : "No properties are in your pipeline yet. Review the seller leads below, or capture a property in Harvester and qualify it in Seller Engine first."}</p>
              <Link href="/workspace/harvester" className="brand-button mt-4 inline-flex px-4 py-3 text-sm">Open property intake</Link>
            </div>
          )}
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
                    The Helix workspace now tells apart environment readiness from database readiness, so you can see whether Deal Engine is fully persistent or still leaning on fallback reads.
                  </div>
                </div>
                <StatusPill tone={persistenceTone} label={persistenceLabel} />
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                  {snapshot.persistence.detail}
                </div>
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                  {snapshot.persistence.mode === "live"
                    ? "Live reads and writes are available for deal records, analysis, conversations, contracts, packets, rooms, and disposition logs."
                    : snapshot.persistence.mode === "schema-missing"
                      ? "The app can still read Seller Engine and Nexus inputs, but Deal Engine persistence is not fully active until the Supabase migration is applied."
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
          {hasSellerSignals ? (
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
          ) : (
            <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
              No live seller handoffs are available right now.
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="Buyer Inputs"
          title="Buyer Engine activation signals"
          description="These are the downstream buyer outputs Deal Engine can use for packaging, buyer matching, and outreach-ready disposition decisions."
        >
          {hasBuyerSignals ? (
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
          ) : (
            <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
              No live buyer records are available for packaging yet.
            </div>
          )}
        </Panel>
      </div>

      <Panel
        eyebrow="Action Console"
        title="Push the deal forward"
        description="Move a seller lead into Deal Engine, save contract posture, and generate buyer outreach drafts without leaving the Helix command surface."
      >
        <DealEngineActions
          sellerSignals={snapshot.sellerSignals}
          buyerSignals={snapshot.buyerSignals}
          contractDrafts={snapshot.contractDrafts}
          persistence={snapshot.persistence}
        />
      </Panel>

      <Panel
        eyebrow="Assembly"
        title="Contract and outreach workbench"
        description="This is the synthesis layer: Deal Engine can now read seller context and buyer momentum together, then turn that into contract-ready posture and outreach sequencing."
      >
        {hasContractDrafts ? (
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
        ) : (
          <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
            No live contract workbench entries are available because there are no persisted Deal Engine records yet.
          </div>
        )}
      </Panel>
      <details className="brand-card p-5">
        <summary className="min-h-11 cursor-pointer py-3 text-lg font-semibold text-white">More workspace tools</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {dealEngineFlow.map((step) => <Link key={step.label} href={step.href} className="brand-button inline-flex px-4 py-3 text-sm">{step.label}</Link>)}
          <Link href="/workspace/nexus" className="brand-button inline-flex px-4 py-3 text-sm">Open Nexus</Link>
          <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-4 py-3 text-sm">Open buyer workspace</Link>
          <Link href="/ecosystem/deal-engine" className="brand-button inline-flex px-4 py-3 text-sm">Public division page</Link>
        </div>
      </details>
    </DealEngineShell>
  );
}
