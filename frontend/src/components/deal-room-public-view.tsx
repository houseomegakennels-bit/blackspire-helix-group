import Link from "next/link";

import { DealRoomInterestForm } from "@/components/deal-room-interest-form";
import { DivisionWatermark } from "@/components/division-watermark";
import { Panel, StatusPill } from "@/components/buyer-shell";
import { brandAssets } from "@/lib/brand-assets";
import type { DealEngineDealDetail } from "@/lib/deal-engine-server";

/**
 * Deal Engine surface uses the shared `theme-deal-engine` class for its logo
 * palette (teal primary / silver / gold accent), matching DealEngineShell so
 * the public investor deal room — which renders its own <main> — stays on-brand.
 */
export function DealRoomPublicView({
  detail,
}: {
  detail: DealEngineDealDetail;
}) {
  return (
    <main
      className="theme-deal-engine relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,hsl(193_100%_60%/.14),transparent_28%),radial-gradient(circle_at_78%_12%,hsl(44_73%_62%/.12),transparent_20%),linear-gradient(180deg,hsl(224_24%_4%)_0%,hsl(213_20%_4%)_24%,hsl(218_20%_6%)_100%)] text-foreground"
    >
      <DivisionWatermark logoSrc={brandAssets.dealEngine.logo} />
      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
        <header className="brand-panel overflow-hidden px-6 py-7">
          <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <div className="space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Private Investor Deal Room</p>
                <h1 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                  {detail.lead.propertyAddress}
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                  {detail.room.propertySummary}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={`/api/deal-engine/${encodeURIComponent(detail.lead.id)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                  {detail.room.downloadablePdfLabel}
                </a>
                <Link href={`/workspace/deal-engine/${encodeURIComponent(detail.lead.id)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Internal packet source
                </Link>
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
              <DealRoomInterestForm slug={detail.room.slug} dealId={detail.lead.id} submitLabel={detail.room.submitInterestLabel} />
            </div>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
          <Panel
            eyebrow="Investor Summary"
            title="Opportunity Overview"
            description="A concise buyer-facing summary prepared through Blackspire Deal Engine."
          >
            <div className="space-y-4">
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.packet.investorSummary}
              </div>
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Property notes</div>
                <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{detail.packet.propertyNotes}</div>
              </div>
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Map and market context</div>
                <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{detail.room.mapPlaceholder}</div>
              </div>
            </div>
          </Panel>

          <Panel
            eyebrow="Disposition Assets"
            title="Packet Notes and Comps"
            description="Saved comps and buyer-facing messaging prepared from the internal deal workstation."
          >
            <div className="space-y-4">
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Comparable anchors</div>
                <div className="mt-3 grid gap-2">
                  {detail.room.compsPlaceholder.map((comp) => (
                    <div key={comp} className="rounded-[14px] border border-[var(--line)] px-3 py-3 text-sm text-[var(--copy-soft)]">
                      {comp}
                    </div>
                  ))}
                </div>
              </div>
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Buyer email blast</div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--copy-soft)]">{detail.packet.buyerEmailBlast}</div>
              </div>
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Buyer SMS alert</div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--copy-soft)]">{detail.packet.buyerSmsAlert}</div>
              </div>
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Contact instructions</div>
                <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{detail.packet.contactInstructions}</div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
