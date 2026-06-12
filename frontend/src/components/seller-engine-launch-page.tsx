import Link from "next/link";

import { SellerEngineShell } from "@/components/seller-engine-shell";
import { SellerSweepForm } from "@/components/seller-sweep-form";

type SourceOption = {
  key: string;
  label: string;
  description: string;
};

export function SellerEngineLaunchPage({ sources }: { sources: SourceOption[] }) {
  return (
    <SellerEngineShell>
      <section className="seller-panel seller-hero overflow-hidden p-6 lg:p-8">
        <div className="relative grid gap-7 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.44em] text-[var(--seller-silver)]">Seller launch surface</p>
            <h2 className="brand-display mt-4 max-w-4xl text-5xl leading-[0.98] text-white lg:text-7xl">
              Pull live county data.
              <br />
              <span className="seller-accent-text">Build the next seller queue.</span>
            </h2>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              Trigger a live seller sweep against the selected county source, score the incoming
              records, and push qualified leads into the Seller Engine command deck without leaving
              the workspace.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/workspace/seller-engine" className="seller-button">
                Open command deck
              </Link>
              <Link href="/workspace/nexus" className="seller-button">
                Open Nexus
              </Link>
              <Link href="/workspace/deal-engine" className="seller-button">
                Open Deal Engine
              </Link>
            </div>
          </div>

          <div className="seller-card grid content-start gap-4 p-5">
            <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--seller-gold)]">
              Launch sequence
            </div>
            {[
              ["1", "Select a live source", "Use county-specific or statewide seller feeds already wired into the platform."],
              ["2", "Run the sweep", "The search executes only when an operator initiates it and imports ranked seller leads."],
              ["3", "Move downstream", "Push verified leads into Nexus for contact resolution or Deal Engine for acquisition work."],
            ].map(([step, title, detail]) => (
              <div key={step} className="rounded-[18px] border border-[var(--seller-line)] bg-[hsl(0_0%_100%/.02)] p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--seller-silver)]">Step {step}</div>
                <div className="mt-2 text-lg font-semibold text-white">{title}</div>
                <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="seller-panel p-5 lg:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="seller-kicker">Launch intake</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">New seller sweep</h3>
            </div>
            <span className="seller-signal">{sources.length} live source{sources.length === 1 ? "" : "s"}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
            Choose the source, county, optional city filter, and maximum import size. Results flow
            directly back into Seller Engine after scoring.
          </p>
          <div className="mt-5">
            <SellerSweepForm sources={sources} />
          </div>
        </div>

        <div className="space-y-5">
          <div className="seller-panel p-5 lg:p-6">
            <p className="seller-kicker">Operator notes</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">How this mirrors Buyer Engine</h3>
            <div className="mt-4 grid gap-3">
              <div className="seller-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                Seller Engine now has a dedicated launch route under the workspace path, matching the
                Buyer Engine pattern of a focused intake surface separate from the dashboard.
              </div>
              <div className="seller-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                The command deck links here directly, and the shared workspace route now resolves
                cleanly anywhere the rest of the platform references Seller Engine.
              </div>
              <div className="seller-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                CSV imports remain available on the main Seller Engine dashboard for bulk offline
                county uploads.
              </div>
            </div>
          </div>

          <div className="seller-panel p-5 lg:p-6">
            <p className="seller-kicker">Next actions</p>
            <div className="mt-4 grid gap-3">
              <Link
                href="/workspace/seller-engine"
                className="block rounded-[18px] border border-[var(--seller-line)] bg-[hsl(0_0%_100%/.02)] px-4 py-4 transition hover:border-[var(--seller-line-strong)]"
              >
                <div className="text-base font-semibold text-white">Review seller leads</div>
                <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">
                  Open the ranked queue, dossier, source coverage board, and scoring controls.
                </div>
              </Link>
              <Link
                href="/workspace/nexus"
                className="block rounded-[18px] border border-[var(--seller-line)] bg-[hsl(0_0%_100%/.02)] px-4 py-4 transition hover:border-[var(--seller-line-strong)]"
              >
                <div className="text-base font-semibold text-white">Resolve contact data</div>
                <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">
                  Push qualified sellers into Nexus when skip trace and decision-maker verification are next.
                </div>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SellerEngineShell>
  );
}
