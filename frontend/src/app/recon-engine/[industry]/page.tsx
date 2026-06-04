import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DivisionWatermark } from "@/components/division-watermark";
import { MarketingShell } from "@/components/marketing-shell";
import { ReconEngineLeadForm } from "@/components/recon-engine-lead-form";
import { brandAssets } from "@/lib/brand-assets";
import { divisionThemeStyle } from "@/lib/division-theme";
import {
  getReconIndustryPage,
  reconEngineBrand,
  reconIndustryPages,
  reconPillars,
} from "@/lib/recon-engine";

export function generateStaticParams() {
  return reconIndustryPages.map((page) => ({ industry: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ industry: string }>;
}): Promise<Metadata> {
  const { industry } = await params;
  const page = getReconIndustryPage(industry);
  if (!page) return { title: "Blackspire Recon Engine" };
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical: `/recon-engine/${page.slug}` },
  };
}

export default async function ReconIndustryPage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const { industry } = await params;
  const page = getReconIndustryPage(industry);
  if (!page) notFound();

  return (
    <MarketingShell>
      <DivisionWatermark logoSrc={brandAssets.reconEngine.logo} fixed />
      <div
        className="theme-recon-engine mx-auto max-w-[1450px] space-y-10 px-4 py-16 lg:px-6"
        style={divisionThemeStyle("recon-engine")}
      >

        {/* HERO */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10 lg:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-[radial-gradient(circle,hsl(258_90%_60%/.16),transparent_65%)] blur-3xl" />
            <div className="absolute -bottom-16 left-1/4 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.08),transparent_65%)] blur-3xl" />
          </div>
          <div className="relative z-10 grid items-center gap-10 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <p className="cmd-text" style={{ color: "#c4b5fd" }}>
                  RECON ENGINE / {page.industry}
                </p>
              </div>
              <h1 className="brand-accent-text mt-4 text-4xl font-black leading-[1.05] tracking-tight lg:text-6xl">
                {page.headline}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-[var(--copy-soft)]">{page.intro}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="#scan" className="recon-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em]">
                  Get free opportunity scan
                </Link>
                <Link href="/recon-engine#pricing" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  View plans
                </Link>
              </div>
              <p className="mt-4 text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                {reconEngineBrand.tagline}
              </p>
            </div>
            <div className="relative mx-auto w-full max-w-[380px]">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(258_90%_60%/.18),transparent_60%)] blur-2xl" />
              <Image
                src={reconEngineBrand.logo}
                alt={`Blackspire Recon Engine — ${page.industry}`}
                width={1254}
                height={1254}
                priority
                className="relative h-auto w-full object-contain"
              />
            </div>
          </div>
        </section>

        {/* WHY IT MATTERS */}
        <section className="grid gap-4 md:grid-cols-3">
          {page.pains.map((pain) => (
            <div key={pain} className="brand-card p-5">
              <div className="signal-bar w-8" />
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{pain}</p>
            </div>
          ))}
        </section>

        {/* PILLARS */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {reconPillars.map((pillar) => (
            <div key={pillar.key} className="brand-card p-5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[hsl(258_90%_70%/.35)] bg-[hsl(258_90%_60%/.12)] text-2xl">
                {pillar.icon}
              </div>
              <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.16em]" style={{ color: "#c4b5fd" }}>
                {pillar.title}
              </h3>
              <p className="mt-2 text-xs leading-6 text-[var(--copy-soft)]">{pillar.copy}</p>
            </div>
          ))}
        </section>

        {/* LEAD MAGNET */}
        <section id="scan" className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="brand-panel px-6 py-8 lg:px-8">
            <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Free scan</p>
            <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
              See the {page.industry.toLowerCase()} opportunities in your county.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Tell us where you operate and Recon Engine generates a free Opportunity Snapshot of the
              contract, grant, and vendor-program channels your {page.industry.toLowerCase()} business
              should be tracking right now.
            </p>
          </div>
          <div className="brand-panel px-6 py-8 lg:px-8">
            <ReconEngineLeadForm defaultIndustry={page.industry} />
          </div>
        </section>

        {/* CTA */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 text-center lg:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(258_90%_60%/.12),transparent_60%)]" />
          <div className="relative z-10 mx-auto max-w-3xl">
            <h2 className="brand-display text-3xl text-white lg:text-4xl">
              Your competitors are bidding on {page.industry.toLowerCase()} work. Are you seeing it?
            </h2>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="#scan" className="recon-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em]">
                Get free opportunity scan
              </Link>
              <Link href="/recon-engine" className="brand-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em] transition">
                Back to Recon Engine
              </Link>
            </div>
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
