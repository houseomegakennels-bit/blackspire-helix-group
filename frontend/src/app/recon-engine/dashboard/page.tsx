import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { ReconDashboard } from "@/components/recon-dashboard";
import { listRecentOpportunities } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recon Dashboard — Live Opportunities | Blackspire Recon Engine",
  description:
    "Live, AI-analyzed government opportunities fit-scored to your business — from Blackspire Recon Engine.",
};

export default async function ReconDashboardPage() {
  const opportunities = await listRecentOpportunities(40).catch(() => []);

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] space-y-8 px-4 py-16 lg:px-6">
        <section className="brand-panel relative overflow-hidden px-6 py-10 lg:px-10">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(258_90%_60%/.14),transparent_65%)] blur-3xl" />
          </div>
          <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <p className="cmd-text" style={{ color: "#c4b5fd" }}>RECON ENGINE / Live Opportunities</p>
              </div>
              <h1 className="brand-accent-text mt-3 text-4xl font-black tracking-tight lg:text-5xl">
                Recon Dashboard
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">
                A live feed of government opportunities, AI-analyzed and fit-scored to your business.
                The feed refreshes automatically every day.
              </p>
            </div>
            <Link href="/recon-engine" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Back to Recon Engine
            </Link>
          </div>
        </section>

        <ReconDashboard opportunities={opportunities} />
      </div>
    </MarketingShell>
  );
}
