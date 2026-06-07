import Image from "next/image";

import { StatusPill } from "@/components/buyer-shell";
import { NexusTraceAction } from "@/components/nexus-trace-action";
import { NexusShell } from "@/components/nexus-shell";
import { brandAssets } from "@/lib/brand-assets";
import { getNexusSnapshot } from "@/lib/nexus-server";

export const dynamic = "force-dynamic";

export default async function NexusLeadsPage() {
  const snapshot = await getNexusSnapshot();

  return (
    <NexusShell>
      <section className="brand-panel overflow-hidden px-6 py-8">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[34%] bg-[radial-gradient(circle_at_center,hsl(267_90%_70%/.12),transparent_74%)]" />
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Nexus Leads</p>
            <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">Lead intake and skip trace queue</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              This queue is where Seller Engine and Deal Engine records enter Nexus for identity resolution, contact enrichment, and confidence scoring before acquisitions outreach.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <StatusPill tone="good" label={`${snapshot.leads.length} queued`} />
              <StatusPill tone="active" label="tracerfy relay" />
              <StatusPill tone="neutral" label="manual review ready" />
            </div>
          </div>
          <div className="brand-card overflow-hidden p-5">
            <div className="relative mx-auto h-[172px] w-full max-w-[248px]">
              <Image
                src={brandAssets.nexus.logo}
                alt={brandAssets.nexus.name}
                fill
                priority
                className="object-contain"
                sizes="248px"
              />
            </div>
            <div className="mt-4 text-center text-sm leading-7 text-[var(--copy-soft)]">
              Connecting properties to people with verified contact posture before the acquisition team makes first touch.
            </div>
          </div>
        </div>

        <div className="brand-hairline mt-8" />
        <div className="brand-table-shell mt-6 overflow-x-auto rounded-[22px]">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="brand-table-head text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">
              <tr>
                {["Owner", "Property", "Seller Score", "Skip Trace Status", "Primary Phone", "Primary Email", "Confidence", "Provider", "Last Updated", "Actions"].map((item) => (
                  <th key={item} className="px-3 py-3">{item}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.leads.map((lead) => (
                <tr key={lead.id} className="border-t border-[var(--line)] bg-[hsl(0_0%_100%/.01)]">
                  <td className="px-3 py-3 text-white">{lead.owner}</td>
                  <td className="px-3 py-3 text-[var(--copy-soft)]">{lead.property}</td>
                  <td className="px-3 py-3 text-white">{lead.sellerScore}</td>
                  <td className="px-3 py-3 text-[var(--copy-soft)]">{lead.skipTraceStatus}</td>
                  <td className="px-3 py-3 text-[var(--copy-soft)]">{lead.primaryPhone}</td>
                  <td className="px-3 py-3 text-[var(--copy-soft)]">{lead.primaryEmail}</td>
                  <td className="px-3 py-3 text-white">{lead.confidence}</td>
                  <td className="px-3 py-3 text-[var(--copy-soft)]">{lead.provider}</td>
                  <td className="px-3 py-3 text-[var(--copy-soft)]">{new Date(lead.lastUpdated).toLocaleString()}</td>
                  <td className="px-3 py-3">
                    <NexusTraceAction
                      leadId={lead.id}
                      currentPhone={lead.primaryPhone}
                      currentEmail={lead.primaryEmail}
                      currentStatus={lead.skipTraceStatus}
                      contactProfileHref={`/workspaces/nexus/contacts?lead=${encodeURIComponent(lead.id)}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </NexusShell>
  );
}
