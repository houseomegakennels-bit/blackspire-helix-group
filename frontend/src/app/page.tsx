import Link from "next/link";

import { EcosystemCard } from "@/components/ecosystem-card";
import { LuxuryHeroStage } from "@/components/luxury-hero-stage";
import { MarketingShell } from "@/components/marketing-shell";
import {
  ecosystemProjects,
  industries,
  parentBrand,
  serviceLines,
  useCases,
} from "@/lib/ecosystem";

const marqueeItems = [
  "Luxury automation systems",
  "Lead capture intelligence",
  "Workflow command surfaces",
  "Vertical AI operating systems",
  "Founder-grade product strategy",
  "Premium client acquisition design",
] as const;

const proofMetricBase = [
  { label: "Automation lanes", value: "24/7", copy: "Always-on flows for leads, routing, follow-up, and visibility." },
  { label: "Operator posture", value: "Elite", copy: "Built to feel like a command center, not SaaS clutter." },
] as const;

export default function Home() {
  const divisionCount = String(ecosystemProjects.length).padStart(2, "0");
  const proofMetrics = [
    { label: "Division systems", value: divisionCount, copy: "Specialized operating layers under one command brand." },
    ...proofMetricBase,
  ];
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1500px] px-4 py-8 lg:px-6 lg:py-10">
        <div className="luxury-home">
          <section className="luxury-hero brand-panel px-6 py-8 lg:px-8 lg:py-10">
            <div className="grid gap-10 xl:grid-cols-[0.95fr_1.05fr] xl:items-center">
              <div className="luxury-hero-copy space-y-8">
                <div className="space-y-5">
                  <div className="luxury-badge">
                    <span className="luxury-badge-dot" />
                    <span className="luxury-kicker">BLACKSPIRE HELIX GROUP / Parent command brand</span>
                  </div>
                  <div className="space-y-4">
                    <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold-soft)]">
                      Premium AI infrastructure
                    </p>
                    <h1 className="luxury-hero-title brand-display brand-accent-text">
                      Design AI employees that feel engineered for power, speed, and taste.
                    </h1>
                    <p className="luxury-hero-subtitle text-[var(--copy-soft)]">
                      {parentBrand.description} We build luminous command surfaces, specialized
                      vertical systems, and automations that make operators feel unfairly well-armed.
                    </p>
                  </div>
                </div>

                <div className="luxury-hero-cta">
                  <Link href="/contact" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                    Book Strategy Call
                  </Link>
                  <Link href="/ecosystem" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                    Tour the Ecosystem
                  </Link>
                  <Link href="/recon-engine" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                    Open Recon Engine
                  </Link>
                </div>

                <div className="luxury-metric-grid">
                  {proofMetrics.map((metric) => (
                    <article key={metric.label} className="luxury-metric-card">
                      <div className="luxury-metric-label">{metric.label}</div>
                      <div className="mt-3 luxury-metric-value">{metric.value}</div>
                      <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{metric.copy}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                <LuxuryHeroStage />
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="brand-card p-4">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                      Positioning
                    </div>
                    <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                      Luxury command systems for operators who want leverage without visual compromise.
                    </div>
                  </div>
                  <div className="brand-card p-4">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                      Surface
                    </div>
                    <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                      Every division becomes a proof-grade product with its own visual and strategic lane.
                    </div>
                  </div>
                  <div className="brand-card p-4">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                      Outcome
                    </div>
                    <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                      Faster response, cleaner systems, stronger perception, and higher-value automation.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="luxury-marquee">
            <div className="luxury-marquee-track">
              {[...marqueeItems, ...marqueeItems].map((item, index) => (
                <span key={`${item}-${index}`} className="luxury-marquee-item">
                  {item}
                </span>
              ))}
            </div>
          </section>

          <section className="luxury-split-grid">
            <article className="brand-panel luxury-story-card col-span-12 px-6 py-8 xl:col-span-5">
              <div className="luxury-section-heading">
                <p className="luxury-kicker">The blackspire thesis</p>
                <h2>One parent identity. Multiple division-grade systems.</h2>
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">
                BLACKSPIRE HELIX GROUP is not positioned like a template-heavy AI agency. The
                parent experience needs to telegraph discretion, engineering depth, and founder
                taste. Every division below is proof that the same operating philosophy can be
                translated into a different market with its own visual language and revenue logic.
              </p>
              <div className="mt-8 grid gap-3">
                {["Luxury brand language", "Operator-first interfaces", "Verticalized AI systems"].map((item) => (
                  <div key={item} className="brand-card flex items-center gap-4 px-4 py-4">
                    <span className="brand-target" />
                    <span className="text-sm tracking-[0.14em] text-white uppercase">{item}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="brand-panel col-span-12 px-6 py-8 xl:col-span-7">
              <div className="luxury-section-heading">
                <p className="luxury-kicker">Service architecture</p>
                <h2>Advanced automation feels different when the experience is curated.</h2>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {serviceLines.map((service, index) => (
                  <div key={service} className="brand-card p-5">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                      Layer {String(index + 1).padStart(2, "0")}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{service}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="brand-panel px-6 py-8 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="luxury-section-heading max-w-3xl">
                <p className="luxury-kicker">Division proof points</p>
                <h2>A private portfolio of elite software houses, under one roof.</h2>
              </div>
              <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                View all divisions
              </Link>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {ecosystemProjects.map((project, index) => (
                <div key={project.slug} className={`reveal-up stagger-${(index % 3) + 1}`}>
                  <EcosystemCard project={project} />
                </div>
              ))}
            </div>
          </section>

          <section className="luxury-split-grid">
            <article className="brand-panel col-span-12 px-6 py-8 xl:col-span-6">
              <div className="luxury-section-heading">
                <p className="luxury-kicker">Execution sequence</p>
                <h2>From founder friction to a system that can actually run without hand-holding.</h2>
              </div>

              <div className="mt-8 luxury-process-list">
                {["Discover", "System design", "Build", "Automation routing", "Operator refinement"].map((step, index) => (
                  <article key={step} className="luxury-process-step" data-step={String(index + 1).padStart(2, "0")}>
                    <h3 className="text-lg font-semibold text-white">{step}</h3>
                    <p className="text-sm leading-7 text-[var(--copy-soft)]">
                      We translate business bottlenecks into elegant automations, branded interfaces,
                      and the kind of visibility operators can actually use under pressure.
                    </p>
                  </article>
                ))}
              </div>
            </article>

            <article className="brand-panel col-span-12 px-6 py-8 xl:col-span-6">
              <div className="luxury-section-heading">
                <p className="luxury-kicker">Use-case matrix</p>
                <h2>Use cases that make AI employees feel tangible, profitable, and immediate.</h2>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {useCases.map((useCase, index) => (
                  <div key={useCase} className="brand-card p-5">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">
                      Signal {String(index + 1).padStart(2, "0")}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{useCase}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="luxury-split-grid">
            <article className="brand-panel col-span-12 px-6 py-8 xl:col-span-7">
              <div className="luxury-section-heading">
                <p className="luxury-kicker">Industry fit</p>
                <h2>Luxury doesn't mean vague. It means every niche gets a tailored operating logic.</h2>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {industries.map((industry) => (
                  <div key={industry.name} className="brand-card p-5">
                    <div className="text-lg font-semibold text-white">{industry.name}</div>
                    <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{industry.summary}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="luxury-cta-panel brand-panel col-span-12 px-6 py-8 xl:col-span-5">
              <div className="luxury-section-heading">
                <p className="luxury-kicker">Founder thesis</p>
                <h2>Systems should feel expensive because clarity is expensive.</h2>
              </div>
              <p className="mt-5 text-sm leading-7 text-[var(--copy-soft)]">
                The parent brand exists to make the whole portfolio legible: one command philosophy,
                multiple revenue-grade products, and enough visual polish that each surface feels
                built for serious operators rather than casual experimentation.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/about" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Read the thesis
                </Link>
                <Link href="/recon-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Explore Recon Engine
                </Link>
                <Link href="/demos" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Review demos
                </Link>
              </div>
            </article>
          </section>

          <section className="luxury-cta-panel brand-panel px-6 py-8 lg:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-4xl">
                <p className="luxury-kicker">Final call</p>
                <h2 className="brand-display mt-3 text-4xl text-white lg:text-5xl">
                  Tell us what you want automated, then let's make it look and behave like a flagship system.
                </h2>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                  Strategy calls, AI-readiness intake, operator dashboards, lead routing, and branded
                  product surfaces can all live under one flagship command identity.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/contact" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Start intake
                </Link>
                <Link href="/recon-engine/dashboard" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  View live opportunities
                </Link>
                <Link href="/services" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Review service map
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </MarketingShell>
  );
}
