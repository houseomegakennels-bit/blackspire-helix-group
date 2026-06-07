import Link from "next/link";
import Image from "next/image";

import { Metric, Panel, StatusPill } from "@/components/buyer-shell";
import { NexusTraceAction } from "@/components/nexus-trace-action";
import { NexusShell } from "@/components/nexus-shell";
import { brandAssets } from "@/lib/brand-assets";
import type { NexusSnapshot } from "@/lib/nexus-server";

export function NexusHome({ snapshot }: { snapshot: NexusSnapshot }) {
  const homeLeads = snapshot.leads.slice(0, 6);
  const dealHandoffs = snapshot.leads
    .filter((lead) => lead.sourceWorkspace.includes("/workspace/deal-engine"))
    .slice(0, 4);

  return (
    <NexusShell>
      <header className="brand-panel overflow-hidden px-6 py-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[38%] bg-[radial-gradient(circle_at_center,hsl(267_90%_70%/.12),transparent_72%)]" />
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Real Estate Intelligence / Nexus</p>
            <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
              The contact intelligence layer between seller discovery and deal creation.
            </h2>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
              Nexus receives qualified seller leads, runs Tracerfy-ready skip trace, scores contact confidence, and prepares contact-ready handoff into Deal Engine. It does not auto-call or auto-text in MVP.
            </p>
            <div className="mt-5 inline-flex items-center gap-3 rounded-full border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[var(--gold-soft)]">
              <span className="h-2 w-2 rounded-full bg-[var(--project-accent)] shadow-[0_0_14px_hsl(267_90%_70%/.42)]" />
              Connecting Properties To People
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/workspaces/nexus/leads" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open lead queue
              </Link>
              <Link href="/workspaces/nexus/settings" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open settings
              </Link>
              <Link href="/workspace/deal-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open deal engine
              </Link>
            </div>
          </div>
          <div className="grid gap-4 content-start">
            <div className="brand-card overflow-hidden p-5">
              <div className="relative mx-auto h-[188px] w-full max-w-[268px]">
                <Image
                  src={brandAssets.nexus.logo}
                  alt={brandAssets.nexus.name}
                  fill
                  priority
                  className="object-contain"
                  sizes="268px"
                />
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <StatusPill tone={snapshot.settings.tracerfyEnabled ? "good" : "warn"} label={snapshot.settings.tracerfyEnabled ? "tracerfy enabled" : "tracerfy disabled"} />
                <StatusPill tone={snapshot.settings.apiKeyConfigured ? "good" : "warn"} label={snapshot.settings.apiKeyConfigured ? "api key configured" : "api key missing"} />
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--gold-soft)]">Compliance Reminder</div>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                Confirm local, state, federal, and platform compliance before calling, texting, or marketing. Nexus generates scripts and recommendations only in MVP.
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {snapshot.metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
        ))}
      </section>

      <Panel eyebrow="Lead Queue" title="Hot leads awaiting enrichment" description="These are the highest-priority seller records waiting on Nexus before they should become acquisition-ready.">
        <div className="space-y-4">
          {homeLeads.map((lead) => (
            <div key={lead.id} className="brand-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{lead.property}</div>
                  <div className="mt-1 text-sm text-[var(--copy-soft)]">{lead.owner} / {lead.county} County</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={lead.eligibleForAutoTrace ? "good" : "warn"} label={lead.eligibleForAutoTrace ? "auto-eligible" : "manual review"} />
                  <StatusPill tone={/queued|needed/i.test(lead.skipTraceStatus) ? "warn" : "good"} label={lead.skipTraceStatus.toLowerCase()} />
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-[16px] border border-[var(--line)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Seller score</div>
                  <div className="mt-2 text-lg font-semibold text-white">{lead.sellerScore}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Primary phone</div>
                  <div className="mt-2 text-sm text-[var(--copy-soft)]">{lead.primaryPhone}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Primary email</div>
                  <div className="mt-2 text-sm text-[var(--copy-soft)]">{lead.primaryEmail}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Confidence</div>
                  <div className="mt-2 text-lg font-semibold text-white">{lead.confidence}</div>
                </div>
              </div>
              <div className="mt-4">
                <NexusTraceAction
                  leadId={lead.id}
                  currentPhone={lead.primaryPhone}
                  currentEmail={lead.primaryEmail}
                  currentStatus={lead.skipTraceStatus}
                  contactProfileHref={`/workspaces/nexus/contacts?lead=${encodeURIComponent(lead.id)}`}
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {dealHandoffs.length ? (
        <Panel
          eyebrow="Deal Engine Handoffs"
          title="Deals waiting on contact resolution"
          description="These Deal Engine records are also in Nexus so operators can run skip trace and verify the seller lane before acquisition outreach."
        >
          <div className="grid gap-4 xl:grid-cols-2">
            {dealHandoffs.map((lead) => (
              <div key={lead.id} className="brand-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{lead.property}</div>
                    <div className="mt-1 text-sm text-[var(--copy-soft)]">{lead.owner} / score {lead.sellerScore}</div>
                  </div>
                  <StatusPill tone={/queued|needed/i.test(lead.skipTraceStatus) ? "warn" : "good"} label={lead.skipTraceStatus.toLowerCase()} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[16px] border border-[var(--line)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Phone</div>
                    <div className="mt-2 text-sm text-[var(--copy-soft)]">{lead.primaryPhone}</div>
                  </div>
                  <div className="rounded-[16px] border border-[var(--line)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Confidence</div>
                    <div className="mt-2 text-sm text-white">{lead.confidence}</div>
                  </div>
                  <Link href={lead.sourceWorkspace} className="brand-button justify-center px-4 py-3 text-xs uppercase tracking-[0.16em]">
                    Open deal
                  </Link>
                </div>
                <div className="mt-4">
                  <NexusTraceAction
                    leadId={lead.id}
                    currentPhone={lead.primaryPhone}
                    currentEmail={lead.primaryEmail}
                    currentStatus={lead.skipTraceStatus}
                    contactProfileHref={`/workspaces/nexus/contacts?lead=${encodeURIComponent(lead.id)}`}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </NexusShell>
  );
}
