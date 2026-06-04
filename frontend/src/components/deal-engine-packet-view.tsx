import Link from "next/link";

import { DealEngineShell } from "@/components/deal-engine-shell";
import { Panel, StatusPill } from "@/components/buyer-shell";
import type { DealEngineDealDetail } from "@/lib/deal-engine-server";

export function DealEnginePacketView({
  dealId,
  detail,
}: {
  dealId: string;
  detail: DealEngineDealDetail;
}) {
  return (
    <DealEngineShell>
      <header className="brand-panel overflow-hidden px-6 py-7">
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Investor Packet</p>
              <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                {detail.lead.propertyAddress}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                Blackspire Deal Engine packet for {detail.lead.ownerName} in {detail.lead.county} County. This page is the branded buyer-facing summary generated from the live deal workstation.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/workspace/deal-engine/${encodeURIComponent(dealId)}`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Back to workstation
              </Link>
              <a href={`/api/deal-engine/${encodeURIComponent(dealId)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Download PDF packet
              </a>
            </div>
          </div>
          <div className="grid gap-4 content-start">
            <div className="brand-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-white">Deal summary</div>
                <StatusPill tone="good" label={detail.lead.status.toLowerCase()} />
              </div>
              <div className="mt-4 space-y-3 text-sm text-[var(--copy-soft)]">
                <div>MAO: <span className="font-semibold text-white">{detail.lead.mao}</span></div>
                <div>Assignment target: <span className="font-semibold text-white">{detail.lead.assignmentFee}</span></div>
                <div>Exit strategy: <span className="font-semibold text-white">{detail.lead.exitStrategy}</span></div>
                <div>Offer deadline: <span className="font-semibold text-white">{detail.packet.deadlineToSubmitOffer}</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <Panel
          eyebrow="Investor Summary"
          title="Why this deal exists"
          description="This section is the concise narrative the Disposition Command can send externally."
        >
          <div className="space-y-4">
            <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
              {detail.packet.investorSummary}
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Property notes</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.packet.propertyNotes}
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Comparable anchors</div>
              <div className="mt-3 grid gap-2">
                {detail.packet.comps.map((comp) => (
                  <div key={comp} className="rounded-[14px] border border-[var(--line)] px-3 py-3 text-sm text-[var(--copy-soft)]">
                    {comp}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Outreach Copy"
          title="Buyer-facing release copy"
          description="This is the export-ready language already saved in Deal Engine."
        >
          <div className="space-y-4">
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Email blast</div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--copy-soft)]">
                {detail.packet.buyerEmailBlast}
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">SMS alert</div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--copy-soft)]">
                {detail.packet.buyerSmsAlert}
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Contact instructions</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.packet.contactInstructions}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </DealEngineShell>
  );
}
