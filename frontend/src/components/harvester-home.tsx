import Link from "next/link";

import { DivisionWatermark } from "@/components/division-watermark";
import { HarvesterCommand } from "@/components/harvester-command";
import { HarvesterIdentity } from "@/components/harvester-identity";
import { RealEstateWorkflowRail } from "@/components/real-estate-workflow-rail";
import type { HarvesterWorkspaceSnapshot } from "@/lib/harvester-server";

export function HarvesterHome({ snapshot }: { snapshot: HarvesterWorkspaceSnapshot }) {
  return (
    <main className="theme-harvester relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(214,168,79,0.16),transparent_32%),linear-gradient(180deg,#030303,#09090b_42%,#040404)]">
      <DivisionWatermark logoSrc={snapshot.branding.markAvailable ? snapshot.branding.markPath : snapshot.branding.logoPath} />
      <div className="relative z-10 mx-auto max-w-[1480px] px-4 py-8 lg:px-6 lg:py-10">
        <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
          <aside className="space-y-5">
            <div className="brand-card p-5">
              <HarvesterIdentity branding={snapshot.branding} size="compact" />
              <div className="mt-4 text-xs uppercase tracking-[0.28em] text-[var(--gold-soft)]">Opportunity Acquisition Intelligence</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                Intake command for screenshots, pasted posts, flyers, PDFs, SMS, and email opportunities.
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/harvester" className="harvester-mini-link">
                  Public page
                </Link>
                <Link href="/seller-engine" className="harvester-mini-link">
                  Seller Engine
                </Link>
              </div>
            </div>

            <RealEstateWorkflowRail active="harvester" />
          </aside>

          <section className="space-y-6">
            <div className="brand-panel harvester-panel relative overflow-hidden p-6 lg:p-7">
              <div className="harvester-header-grid" aria-hidden="true" />
              <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.4em] text-[var(--gold-soft)]">Harvester Workspace</div>
                  <h1 className="mt-3 text-3xl font-black tracking-[0.05em] text-white sm:text-4xl">
                    Extract. Analyze. Acquire.
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                    Capture raw marketplace chatter, structure it into Blackspire opportunity records, and push the approved deals into Seller Engine, Nexus, Deal Engine, and Buyer Engine without leaving the command surface.
                  </p>
                </div>

                <div className="max-w-[280px]">
                  <HarvesterIdentity branding={snapshot.branding} />
                </div>
              </div>
            </div>

            <HarvesterCommand snapshot={snapshot} />
          </section>
        </div>
      </div>
    </main>
  );
}
