import type { CSSProperties } from "react";
import Link from "next/link";

import { DivisionWatermark } from "@/components/division-watermark";
import { HarvesterIdentity } from "@/components/harvester-identity";
import { MarketingShell } from "@/components/marketing-shell";
import { getHarvesterWorkspaceSnapshot } from "@/lib/harvester-server";

export default async function HarvesterPage() {
  const snapshot = await getHarvesterWorkspaceSnapshot();
  const style = {
    "--project-accent": "#d6a84f",
    "--project-glow": "rgba(214, 168, 79, 0.34)",
    "--project-surface": "rgba(214, 168, 79, 0.12)",
    "--project-edge": "rgba(191, 196, 201, 0.26)",
  } as CSSProperties;

  return (
    <MarketingShell themeStyle={style}>
      <div className="theme-harvester min-h-screen bg-[radial-gradient(circle_at_top,rgba(214,168,79,0.14),transparent_26%),linear-gradient(180deg,#030303,#070707_42%,#020202)]">
        <DivisionWatermark logoSrc={snapshot.branding.markAvailable ? snapshot.branding.markPath : snapshot.branding.logoPath} fixed />

        <section className="relative overflow-hidden px-4 py-20 lg:px-6 lg:py-28">
          <div className="mx-auto grid max-w-[1460px] gap-12 xl:grid-cols-[1.08fr_0.92fr] xl:items-center">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.44em] text-[var(--gold-soft)]">BLACKSPIRE HELIX GROUP / REAL ESTATE INTELLIGENCE</div>
              <h1 className="mt-5 text-5xl font-black leading-[0.94] tracking-tight text-white sm:text-6xl xl:text-7xl">
                HARVESTER
              </h1>
              <p className="mt-5 text-lg uppercase tracking-[0.32em] text-[var(--copy-soft)]">Opportunity Acquisition Intelligence</p>
              <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--copy-soft)]">
                Harvest deal opportunities from screenshots, pasted posts, emails, SMS, flyers, PDFs, and marketplace chatter, then convert them into structured Blackspire records that flow into Seller Engine, Nexus, Deal Engine, and Buyer Engine.
              </p>
              <p className="mt-4 max-w-2xl text-base font-semibold leading-8 text-white">
                Extract. Analyze. Acquire.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/workspace/harvester" className="brand-button px-7 py-4 text-sm uppercase tracking-[0.2em]">
                  Launch Harvester
                </Link>
                <Link href="/real-estate-intelligence" className="harvester-secondary-button">
                  View Real Estate Pipeline
                </Link>
              </div>
            </div>

            <div className="min-w-0 space-y-5">
              <HarvesterIdentity branding={snapshot.branding} size="hero" />
              <div className="brand-panel harvester-panel p-6">
                <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--gold-soft)]">Supported sources</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {["Facebook Groups", "SMS", "Email", "Flyers", "PDFs", "Craigslist", "Manual Address Entry", "Marketplace Posts"].map((item) => (
                    <div key={item} className="harvester-source-pill">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-6 lg:px-6">
          <div className="mx-auto grid max-w-[1460px] gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              "Upload screenshot or paste post",
              "AI extracts deal data",
              "Blackspire reviews opportunity",
              "Buyer Engine ranks buyer demand",
              "Deal Engine launches transaction lane",
            ].map((step, index) => (
              <div key={step} className="brand-panel harvester-panel p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--gold-soft)]">Step {String(index + 1).padStart(2, "0")}</div>
                <div className="mt-3 text-base font-semibold leading-7 text-white">{step}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 py-16 lg:px-6">
          <div className="mx-auto max-w-[1460px]">
            <div className="flex items-end justify-between gap-5">
              <div>
                <div className="text-[10px] uppercase tracking-[0.36em] text-[var(--gold-soft)]">Intelligence features</div>
                <h2 className="mt-3 text-3xl font-black text-white sm:text-4xl">Built for acquisition operators</h2>
              </div>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  title: "Deal extraction",
                  copy: "Turn marketplace noise into structured address, pricing, contact, and condition records with confidence tracking.",
                },
                {
                  title: "Duplicate detection",
                  copy: "Catch recycled inventory using normalized address, price, phone, email, and repeat-poster signals.",
                },
                {
                  title: "Poster profiles",
                  copy: "Build marketplace entities over time so repeat wholesalers, sellers, and buyers become visible across groups and channels.",
                },
                {
                  title: "Buyer signals",
                  copy: "Use county, city, pricing, and investor metadata to rank likely buyer-group fits before outreach starts.",
                },
                {
                  title: "Watchlists",
                  copy: "Monitor target counties, price bands, and property traits for new intake matches and operator alerts.",
                },
                {
                  title: "Heat mapping placeholder",
                  copy: "The surface is ready for future marketplace heat maps and signal overlays once the next data layer is attached.",
                },
              ].map((feature) => (
                <div key={feature.title} className="brand-panel harvester-panel harvester-feature-card p-6">
                  <div className="text-lg font-semibold text-white">{feature.title}</div>
                  <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{feature.copy}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 lg:px-6">
          <div className="mx-auto max-w-[1460px]">
            <div className="brand-panel harvester-panel relative overflow-hidden px-8 py-14 text-center">
              <div className="harvester-header-grid" aria-hidden="true" />
              <div className="relative z-10">
                <div className="text-[10px] uppercase tracking-[0.36em] text-[var(--gold-soft)]">Compliance</div>
                <p className="mx-auto mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                  Only upload content you have permission to use. Harvester is built for user-provided screenshots, uploads, and text intake. It does not log into private groups or violate platform rules.
                </p>
                <div className="mt-8">
                  <Link href="/workspace/harvester" className="brand-button px-8 py-4 text-sm uppercase tracking-[0.2em]">
                    Launch Harvester
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
