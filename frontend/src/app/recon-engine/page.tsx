import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { ReconCheckoutButton } from "@/components/recon-checkout-button";
import { ReconEngineLeadForm } from "@/components/recon-engine-lead-form";
import { brandAssets } from "@/lib/brand-assets";
import { divisionThemeStyle } from "@/lib/division-theme";
import { reconEngineBrand, reconPillars, reconPlans, reconIndustries } from "@/lib/recon-engine";

export const metadata: Metadata = {
  title: "Blackspire Recon Engine — Opportunity Intelligence Before the Competition",
  description:
    "AI-powered opportunity intelligence that discovers government contracts, grants, vendor programs, and revenue opportunities before your competition.",
};

export default function ReconEnginePage() {
  return (
    <MarketingShell watermarkLogoSrc={brandAssets.reconEngine.logo} themeStyle={divisionThemeStyle("recon-engine")}>
      <div
        className="theme-recon-engine mx-auto max-w-[1450px] space-y-10 px-4 py-16 lg:px-6"
        style={divisionThemeStyle("recon-engine")}
      >

        {/* ── HERO ───────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10 lg:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-[radial-gradient(circle,hsl(258_90%_60%/.16),transparent_65%)] blur-3xl" />
            <div className="absolute -bottom-16 left-1/4 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.08),transparent_65%)] blur-3xl" />
          </div>
          <div className="relative z-10 grid items-center gap-10 xl:grid-cols-[1fr_0.85fr]">
            <div>
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <p className="cmd-text" style={{ color: "#c4b5fd" }}>
                  BLACKSPIRE HELIX GROUP / Recon Engine
                </p>
              </div>
              <h1 className="brand-accent-text mt-4 text-5xl font-black leading-[1.02] tracking-tight lg:text-7xl">
                Find Revenue<br />
                <span className="text-white">Before Your</span><br />
                <span className="text-white">Competitors Do.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-[var(--copy-soft)]">
                Blackspire Recon Engine scans contracts, grants, procurement opportunities, and
                business programs to uncover opportunities your competitors never see — then
                fit-scores and matches them to your business.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="#scan" className="recon-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em]">
                  Get free opportunity scan
                </Link>
                <Link href="/recon-engine/dashboard" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  View live opportunities
                </Link>
              </div>
              <p className="mt-4 text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                {reconEngineBrand.tagline}
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-[460px]">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(258_90%_60%/.18),transparent_60%)] blur-2xl" />
              <Image
                src={reconEngineBrand.logo}
                alt="Blackspire Recon Engine"
                width={1254}
                height={1254}
                priority
                className="relative h-auto w-full object-contain"
              />
            </div>
          </div>
        </section>

        {/* ── PILLARS ────────────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-center gap-4">
            <div className="h-px w-12 bg-[hsl(258_90%_60%/.5)]" />
            <p className="text-center text-[11px] uppercase tracking-[0.34em] text-[var(--copy-muted)]">
              Opportunity intelligence <span style={{ color: "#c4b5fd" }}>before</span> the competition
            </p>
            <div className="h-px w-12 bg-[hsl(258_90%_60%/.5)]" />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
          </div>
        </section>

        {/* ── FREE OPPORTUNITY SCAN (lead magnet) ────────────────── */}
        <section id="scan" className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="brand-panel px-6 py-8 lg:px-8">
            <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Free lead magnet</p>
            <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
              Get your free Opportunity Scan.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Tell us your industry and where you operate. Recon Engine generates an instant
              Opportunity Snapshot showing the contract, grant, and vendor-program channels your
              business should be tracking — and the fastest way to start winning them.
            </p>
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">Built for</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {reconIndustries.map((industry) => (
                  <span key={industry} className="recon-pill">{industry}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="brand-panel px-6 py-8 lg:px-8">
            <ReconEngineLeadForm />
          </div>
        </section>

        {/* ── PRICING ────────────────────────────────────────────── */}
        <section id="pricing">
          <div className="mb-6 text-center">
            <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Plans</p>
            <h2 className="brand-display mt-3 text-4xl text-white">Choose your intelligence level</h2>
            <p className="mt-3 text-sm text-[var(--copy-soft)]">
              Subscribe for ongoing matched opportunities, or unlock single opportunities pay-as-you-go.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-4">
            {reconPlans.map((plan) => (
              <div key={plan.id} className="recon-plan-card flex flex-col p-6" data-highlight={plan.highlighted ? "true" : "false"}>
                {plan.highlighted ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-black" style={{ background: "#c4b5fd" }}>
                    Most popular
                  </span>
                ) : null}
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <div className="mt-3 flex items-end gap-1">
                  <span className="brand-accent-text text-4xl font-black">{plan.price}</span>
                  <span className="mb-1 text-xs text-[var(--copy-muted)]">{plan.cadence}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--copy-soft)]">{plan.tagline}</p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm text-[var(--copy-soft)]">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#8b5cf6" }} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <ReconCheckoutButton
                  planId={plan.id}
                  highlighted={plan.highlighted}
                  label={plan.billingModel === "payg" ? "Unlock an opportunity" : `Choose ${plan.name}`}
                />
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-[var(--copy-muted)]">
            Plans are launching soon — start with a free scan and we&apos;ll get you set up.
          </p>
        </section>

        {/* ── BOTTOM CTA ─────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 text-center lg:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(258_90%_60%/.12),transparent_60%)]" />
          <div className="relative z-10 mx-auto max-w-3xl">
            <h2 className="brand-display text-4xl text-white lg:text-5xl">
              Your competitors are bidding. Are you even seeing the opportunities?
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Recon Engine is the opportunity-intelligence layer of the Blackspire Helix Group
              ecosystem — discovering revenue before the competition, across every market we serve.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="#scan" className="recon-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em]">
                Get free opportunity scan
              </Link>
              <Link href="/ecosystem" className="brand-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em] transition">
                Explore the ecosystem
              </Link>
            </div>
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
