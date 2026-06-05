import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing-shell";
import { brandAssets } from "@/lib/brand-assets";
import { divisionThemeStyle } from "@/lib/division-theme";
import { getReconAdminMetrics, type ReconAdminMetrics } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recon Admin | Blackspire Helix Group",
};

export default async function ReconAdminPage() {
  let metrics: ReconAdminMetrics | null = null;
  let denied = false;
  try {
    metrics = await getReconAdminMetrics();
  } catch {
    denied = true;
  }

  return (
    <MarketingShell watermarkLogoSrc={brandAssets.reconEngine.logo} themeStyle={divisionThemeStyle("recon-engine")}>
      <div
        className="theme-recon-engine mx-auto max-w-[1450px] space-y-8 px-4 py-16 lg:px-6"
        style={divisionThemeStyle("recon-engine")}
      >
        <section className="brand-panel px-6 py-8">
          <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Admin / Recon Engine</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-black tracking-tight">Recon Analytics</h1>
          <p className="mt-3 text-sm text-[var(--copy-soft)]">
            Leads, opportunity volume, subscriptions, and industry performance.
          </p>
        </section>

        {denied || !metrics ? (
          <section className="brand-panel px-6 py-8">
            <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Restricted</p>
            <h2 className="brand-display mt-2 text-2xl text-white">Admin access only</h2>
            <p className="mt-2 text-sm text-[var(--copy-soft)]">
              Sign in as the operator/admin account to view Recon analytics.
            </p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Total leads" value={metrics.totalLeads} detail="Free Opportunity Scans" />
              <Metric label="Leads (7 days)" value={metrics.leadsLast7Days} detail="Recent signups" />
              <Metric label="Opportunities" value={metrics.totalOpportunities} detail="Ingested bids" />
              <Metric label="AI-analyzed" value={metrics.analyzedOpportunities} detail="With AI analysis" />
              <Metric label="Subscribers" value={metrics.subscribers} detail="Paid checkouts" />
            </section>

            <section className="brand-panel px-6 py-8">
              <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Industry performance</p>
              <h2 className="brand-display mt-2 text-2xl text-white">Top opportunity industries</h2>
              <div className="mt-4 space-y-2">
                {metrics.topIndustries.length ? metrics.topIndustries.map((row) => (
                  <div key={row.industry} className="brand-card flex items-center justify-between p-4">
                    <span className="text-sm text-white">{row.industry}</span>
                    <span className="brand-accent-text text-lg font-bold">{row.count}</span>
                  </div>
                )) : <p className="text-sm text-[var(--copy-soft)]">No analyzed opportunities yet.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </MarketingShell>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="brand-card p-5">
      <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">{label}</div>
      <div className="brand-accent-text mt-2 text-3xl font-black">{value}</div>
      <div className="mt-1 text-xs text-[var(--copy-soft)]">{detail}</div>
    </div>
  );
}
