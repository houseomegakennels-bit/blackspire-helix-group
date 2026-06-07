import type { Metadata } from "next";
import { EngineHero } from "@/components/engine-hero";
import { MetricCard } from "@/components/metric-card";
import { PipelineFlow } from "@/components/pipeline-flow";
import { RealEstateSuiteLayout } from "@/components/real-estate-suite-layout";
import { WorkspaceCard } from "@/components/workspace-card";
import { getRealEstateDivisionSnapshot } from "@/lib/real-estate-intelligence";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Real Estate Intelligence | Blackspire Helix Group",
  description:
    "Explore the Blackspire real estate intelligence operating system from Seller Engine through buyer-ready deal execution.",
};

export default async function RealEstateIntelligencePage() {
  const snapshot = await getRealEstateDivisionSnapshot();

  return (
    <RealEstateSuiteLayout>
      <EngineHero
        title="Blackspire Real Estate Intelligence"
        subtitle="An AI-powered deal flow operating system built to find motivated sellers, connect with decision makers, analyze wholesale opportunities, and match deals to the right buyers."
        primaryHref="/workspace/nexus"
        primaryLabel="Enter Real Estate Workspace"
        secondaryHref="/ecosystem"
        secondaryLabel="View The Ecosystem"
      />

      <section className="brand-panel px-6 py-8 lg:px-8">
        <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Ecosystem Pipeline</p>
        <h2 className="brand-display mt-3 text-3xl text-white">Seller Engine to closed transaction</h2>
        <div className="mt-6">
          <PipelineFlow engines={snapshot.engines} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.metrics.map((metric) => (
          <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
        ))}
      </section>

      <section className="brand-panel px-6 py-8 lg:px-8">
        <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Division Explanation</p>
        <h2 className="brand-display mt-3 text-3xl text-white">One real-estate division inside Blackspire Helix Group</h2>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
          Blackspire Real Estate Intelligence is the wholesale real estate automation division of Blackspire Helix Group. It groups seller discovery, skip trace, acquisition, and buyer activation into one premium operating system while keeping each engine&apos;s own page and workspace intact.
        </p>
      </section>

      <section className="brand-panel px-6 py-8 lg:px-8">
        <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Workspace Navigation</p>
        <h2 className="brand-display mt-3 text-3xl text-white">Enter each operator surface directly</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {snapshot.engines.map((engine) => (
            <WorkspaceCard
              key={engine.id}
              title={engine.name.replace("Blackspire ", "").replace(" Engine", " Workspace")}
              description={engine.description}
              href={engine.workspacePath}
            />
          ))}
        </div>
      </section>
    </RealEstateSuiteLayout>
  );
}
