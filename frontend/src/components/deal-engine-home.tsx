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
      ? "Connected"
      : snapshot.persistence.mode === "schema-missing"
        ? "Setup needed"
        : "Connection needed";

  return (
    <DealEngineShell home>
      {!snapshot.persistence.ready ? <div role="status" className="workspace-connection-notice rounded-xl border px-5 py-4 text-sm leading-6"><strong>Saving is unavailable.</strong> You can review available information, but changes cannot be saved until the connection is restored. Open Workspace status and help below for details.</div> : null}
      <header className="brand-panel px-6 py-7">
        <h2 className="brand-display text-4xl leading-tight text-white lg:text-5xl">What would you like to work on?</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">Add a property or pick up an existing deal. Each property keeps its numbers, offer terms and next steps together.</p>
        <div className="workspace-actions mt-5 flex flex-wrap gap-3">
          <Link href="/workspace/harvester" className="workspace-primary brand-button inline-flex px-5 py-3 text-sm">Add property</Link>
          {hasLiveDeals ? <a href="#continue-working" className="brand-button inline-flex px-5 py-3 text-sm">Continue working</a> : <Link href="/seller-engine" className="brand-button inline-flex px-5 py-3 text-sm">Review seller leads</Link>}
        </div>
        <p className="mt-3 text-sm text-[var(--copy-soft)]">Start with the address and what you know. You can review seller details before the property joins this list.</p>
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

      <div id="property-queue" className="workspace-property-list">
        <Panel
          eyebrow="Pipeline"
          title="Your properties"
          description="Browse saved properties and open one to continue working. Open Progress by stage below for counts on this page."
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
                      <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Calculated purchase ceiling</div>
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
                      Open property
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
              <p>{listUnavailable ? "The property list is unavailable. Refresh to try again." : "No properties are in this list yet. Add a property, then review and qualify the seller lead."}</p>
              <Link href="/workspace/harvester" className="brand-button mt-4 inline-flex px-4 py-3 text-sm">Open property intake</Link>
            </div>
          )}
        </Panel>

      </div>

      <details className="workspace-disclosure brand-card p-5">
        <summary>Progress by stage <span>View counts and the stage board</span></summary>
        <div className="mt-5 space-y-5">
      <section aria-label="Property metrics for this page" className="grid gap-4 md:grid-cols-4">
        <p className="md:col-span-4 text-sm text-[var(--copy-soft)]">Overview of properties on this page</p>
        {snapshot.metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
        ))}
      </section>

      <Panel
        eyebrow="Pipeline Board"
        title="Where your properties stand"
        description="See the saved stage of each property on this page."
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
                    No properties at this stage on this page.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

        </div>
      </details>

      <details className="workspace-disclosure brand-card p-5">
        <summary>Seller and buyer activity <span>Review handoffs, contacts and saved drafts</span></summary>
        <div className="mt-5 space-y-5">


      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Seller Inputs"
          title="Seller leads ready for review"
          description="Review seller details and the suggested next step before adding a lead to your properties."
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
          title="Potential buyers"
          description="Review potential buyers and their saved activity. A match does not confirm funding or a commitment to buy."
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
        title="Prepare the next step"
        description="Add a qualified seller lead to your properties, save proposed terms or prepare a buyer message."
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
        title="Saved contracts and messages"
        description="Review saved proposed terms and message drafts. A saved draft is not a signed agreement."
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
            No saved contract entries are available yet.
          </div>
        )}
      </Panel>
        </div>
      </details>
      <details className="workspace-disclosure brand-card p-5">
        <summary>Workspace status and help <span>Connection details and available tools</span></summary>
        <div className="mt-5">
        <Panel
          eyebrow="Modules"
          title="Workspace status"
          description="Check connection details or learn what is available in this workspace."
        >
          <div className="space-y-4">
            <div className="brand-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Connection status</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Check whether this workspace can load and save property records.
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
      </details>
      <details className="brand-card p-5">
        <summary className="min-h-11 cursor-pointer py-3 text-lg font-semibold text-white">More workspace tools</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {dealEngineFlow.map((step) => <Link key={step.label} href={step.href} className="brand-button inline-flex px-4 py-3 text-sm">{step.label}</Link>)}
          <Link href="/workspace/nexus" className="brand-button inline-flex px-4 py-3 text-sm">Check contact details</Link>
          <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-4 py-3 text-sm">Open buyer workspace</Link>
          <Link href="/ecosystem/deal-engine" className="brand-button inline-flex px-4 py-3 text-sm">Public division page</Link>
        </div>
      </details>
    </DealEngineShell>
  );
}
