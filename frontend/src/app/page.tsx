import type { Metadata } from "next";
import Link from "next/link";

import { EcosystemCard } from "@/components/ecosystem-card";
import { LuxuryHeroStage } from "@/components/luxury-hero-stage";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects, parentBrand, serviceLines } from "@/lib/ecosystem";
import { realEstatePipeline, workspaceEntries } from "@/lib/site-structure";

export const metadata: Metadata = {
  title: "Blackspire Helix Group | Organized AI Systems for Serious Operators",
  description:
    "Blackspire Helix Group builds organized AI systems across strategy, real estate intelligence, live workspaces, and branded operator divisions.",
};

const commandMetrics = [
  { label: "Active divisions", value: String(ecosystemProjects.length).padStart(2, "0") },
  { label: "Live workspaces", value: String(workspaceEntries.filter((entry) => entry.status === "Live").length).padStart(2, "0") },
  { label: "Core pipeline", value: "04" },
] as const;

const featuredWorkspaces = workspaceEntries.slice(0, 4);
const operatingLanes = [
  {
    id: "01",
    title: "Flagship strategy",
    copy: "Parent-brand positioning, system planning, and the commercial logic behind each division.",
    href: "/services",
    cta: "Review services",
  },
  {
    id: "02",
    title: "Live operator surfaces",
    copy: "Working dashboards and command layers where lead flow, buyers, deals, and service intake are actually run.",
    href: "/workspaces",
    cta: "Open workspaces",
  },
  {
    id: "03",
    title: "Revenue-specific divisions",
    copy: "Each division gets its own audience, visual identity, and workflow logic without losing parent-brand coherence.",
    href: "/ecosystem",
    cta: "See divisions",
  },
] as const;

const proofSignals = [
  {
    label: "What makes this different",
    value: "Command surfaces, not prompts",
    detail: "The site is organized around operator systems that run real workflows instead of generic AI messaging.",
  },
  {
    label: "Where traction shows up",
    value: "Lead flow, routing, closure",
    detail: "The strongest pages show how seller capture, underwriting, buyer matching, and service intake connect end to end.",
  },
] as const;

export default function Home() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1500px] px-3 py-6 sm:px-4 sm:py-8 lg:px-6 lg:py-10">
        <div className="space-y-6 sm:space-y-8">
          <section className="brand-panel px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            <div className="grid gap-8 xl:grid-cols-[0.92fr_1.08fr] xl:items-center">
              <div className="space-y-7">
                <div className="space-y-4">
                  <p className="reveal-up text-xs uppercase tracking-[0.36em] text-[var(--gold-soft)]" style={{ animationDelay: "0.05s" }}>
                    BLACKSPIRE HELIX GROUP
                  </p>
                  <h1 className="reveal-up brand-display brand-accent-text text-3xl leading-tight text-white sm:text-4xl md:text-5xl lg:text-6xl" style={{ animationDelay: "0.12s" }}>
                    Organized AI systems for serious operators.
                  </h1>
                  <p className="reveal-up max-w-3xl text-base leading-8 text-[var(--copy-soft)]" style={{ animationDelay: "0.22s" }}>
                    {parentBrand.description} The operating map is simple: parent company strategy,
                    real estate intelligence, live workspaces, product divisions, and company access.
                  </p>
                </div>

                <div className="reveal-up flex flex-wrap gap-3" style={{ animationDelay: "0.32s" }}>
                  <Link href="/workspaces" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                    Open workspace directory
                  </Link>
                  <Link href="/real-estate-intelligence" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                    Real estate intelligence
                  </Link>
                  <Link href="/ecosystem" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                    View ecosystem
                  </Link>
                </div>

                <div className="scroll-reveal grid gap-3 sm:grid-cols-3" style={{ animationDelay: "0.08s" }}>
                  {commandMetrics.map((metric, i) => (
                    <div key={metric.label} className="brand-card card-lift p-4" style={{ animationDelay: `${i * 0.07}s` }}>
                      <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{metric.label}</div>
                      <div className="brand-display mt-2 text-3xl text-white">{metric.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <LuxuryHeroStage />
            </div>

            <div className="scroll-reveal mt-8 grid gap-4 lg:grid-cols-2">
              {proofSignals.map((signal, i) => (
                <div key={signal.label} className="brand-card card-lift p-5" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">{signal.label}</div>
                  <div className="brand-display mt-3 text-2xl text-white lg:text-3xl">{signal.value}</div>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">{signal.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="brand-panel px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Operating thesis</p>
                <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">
                  The parent brand stays clear by separating strategy, workspaces, and divisions.
                </h2>
              </div>
              <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Start a project brief
              </Link>
            </div>

            <div className="scroll-reveal mt-6 grid gap-4 lg:grid-cols-3" style={{ animationDelay: "0.1s" }}>
              {operatingLanes.map((lane, i) => (
                <Link
                  key={lane.id}
                  href={lane.href}
                  className="brand-card card-lift block p-5"
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{lane.id}</span>
                    <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">{lane.cta}</span>
                  </div>
                  <div className="mt-4 text-xl font-semibold text-white">{lane.title}</div>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{lane.copy}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="brand-panel px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Real estate operating chain</p>
                <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">
                  Seller lead to buyer-ready deal, in one pipeline.
                </h2>
              </div>
              <Link href="/real-estate-intelligence" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Open division
              </Link>
            </div>

            <div className="scroll-reveal mt-6 grid gap-3 lg:grid-cols-4" style={{ animationDelay: "0.1s" }}>
              {realEstatePipeline.map((stage, index) => (
                <Link
                  key={stage}
                  href={
                    stage === "Seller Engine"
                      ? "/workspace/seller-engine"
                      : stage === "Nexus"
                        ? "/workspace/nexus"
                        : stage === "Deal Engine"
                          ? "/workspace/deal-engine"
                          : "/workspace/buyer-engine"
                  }
                  className="brand-card card-lift block p-5"
                  style={{ animationDelay: `${index * 0.07}s` }}
                >
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                    Step {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-3 text-xl font-semibold text-white">{stage}</div>
                  <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
                    {stage === "Seller Engine"
                      ? "Find and score motivated seller opportunities."
                      : stage === "Nexus"
                        ? "Resolve phone, email, DNC, and decision-maker posture."
                        : stage === "Deal Engine"
                          ? "Underwrite, contract, package, coordinate, and close."
                          : "Match deals to investor demand and outreach lanes."}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="brand-panel px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Operator workspaces</p>
                <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">
                  The fastest way into the live tools.
                </h2>
              </div>
              <Link href="/workspaces" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                View all workspaces
              </Link>
            </div>

            <div className="scroll-reveal mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4" style={{ animationDelay: "0.1s" }}>
              {featuredWorkspaces.map((entry, i) => (
                <Link key={entry.href} href={entry.href} className="brand-card card-lift block p-5" style={{ animationDelay: `${i * 0.07}s` }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{entry.division}</span>
                    <span className="rounded-full border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                      {entry.status}
                    </span>
                  </div>
                  <div className="mt-4 text-xl font-semibold text-white">{entry.title}</div>
                  <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{entry.description}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="brand-panel px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Division portfolio</p>
                <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">
                  One parent brand, organized by operating purpose.
                </h2>
              </div>
              <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                View all divisions
              </Link>
            </div>

            <div className="scroll-reveal mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3" style={{ animationDelay: "0.1s" }}>
              {ecosystemProjects.slice(0, 6).map((project) => (
                <EcosystemCard key={project.slug} project={project} />
              ))}
            </div>
          </section>

          <section className="brand-panel px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div className="scroll-reveal">
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Build lanes</p>
              <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">
                What Blackspire Helix Group builds.
              </h2>
            </div>
            <div className="scroll-reveal mt-6 grid gap-4 md:grid-cols-2" style={{ animationDelay: "0.1s" }}>
              {serviceLines.map((service, index) => (
                <div key={service} className="brand-card card-lift p-5" style={{ animationDelay: `${index * 0.05}s` }}>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                    Lane {String(index + 1).padStart(2, "0")}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{service}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </MarketingShell>
  );
}
