import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { industries } from "@/lib/ecosystem";

export const metadata: Metadata = {
  title: "Industries | Blackspire Helix Group",
  description:
    "See how Blackspire Helix Group adapts AI employees, workflow logic, and operator systems for different industries.",
};

const industryAccents = [
  { top: "from-[hsl(38_92%_55%)] to-transparent", icon: "🏚️" },
  { top: "from-[hsl(142_70%_45%)] to-transparent", icon: "🌿" },
  { top: "from-[hsl(270_80%_62%)] to-transparent", icon: "📲" },
  { top: "from-[hsl(210_90%_60%)] to-transparent", icon: "🔬" },
  { top: "from-[hsl(340_80%_60%)] to-transparent", icon: "💎" },
  { top: "from-[hsl(20_100%_55%)] to-transparent", icon: "⚡" },
];

const thesisPillars = [
  {
    number: "01",
    title: "Market-specific intake logic",
    copy: "AI employees only matter when they match the rhythm of a real industry — its vocabulary, urgency cadence, and decision triggers.",
  },
  {
    number: "02",
    title: "Operational language alignment",
    copy: "Every market needs different workflow logic. A real estate investor and a lawn-care operator need radically different automation sequences.",
  },
  {
    number: "03",
    title: "Range without dilution",
    copy: "The parent brand proves range without collapsing into generic AI-agency messaging. Each niche gets its own visual lane and revenue logic.",
  },
] as const;

export default function IndustriesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6 space-y-8">

        {/* ── HERO ─────────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10 lg:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.09),transparent_65%)] blur-3xl" />
            <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-[radial-gradient(circle,hsl(142_70%_45%/.07),transparent_65%)] blur-3xl" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <span className="live-dot" />
              <p className="cmd-text">BLACKSPIRE HELIX GROUP / Industry Intelligence</p>
            </div>
            <h1 className="brand-accent-text mt-4 text-5xl font-black leading-none tracking-tight lg:text-7xl">
              SAME THESIS.<br />
              <span className="text-white">EVERY MARKET.</span>
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--copy-soft)]">
              The Blackspire ecosystem proves that AI employees are not a single generic product.
              They become powerful when shaped around how a specific industry actually sells,
              routes work, and closes revenue. Each niche gets its own automation language.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/recon-engine" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                Explore Recon Engine
              </Link>
              <Link href="/services" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                View service architecture
              </Link>
            </div>
            <div className="mt-6 flex items-center gap-6 flex-wrap">
              <div className="stat-badge">
                <span className="stat-badge-value brand-accent-text">6+</span>
                <span className="stat-badge-label">Active industries</span>
              </div>
              <div className="stat-badge">
                <span className="stat-badge-value brand-accent-text">∞</span>
                <span className="stat-badge-label">Vertical potential</span>
              </div>
              <div className="stat-badge">
                <span className="stat-badge-value brand-accent-text">1</span>
                <span className="stat-badge-label">Command philosophy</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── THESIS PILLARS ────────────────────────────────────────── */}
        <section>
          <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Thesis pillars</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {thesisPillars.map((pillar, i) => (
              <article key={pillar.number} className={`brand-panel card-lift relative overflow-hidden px-6 py-8 shine-card reveal-up stagger-${i + 1}`}>
                <div className="pointer-events-none absolute right-4 top-3 ghost-number opacity-[0.06]">
                  {pillar.number}
                </div>
                <div className="relative z-10 space-y-3">
                  <div className="signal-bar w-10" />
                  <h3 className="text-lg font-bold text-white">{pillar.title}</h3>
                  <p className="text-sm leading-7 text-[var(--copy-soft)]">{pillar.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="glow-line" />

        {/* ── INDUSTRY GRID ─────────────────────────────────────────── */}
        <section>
          <div className="scroll-reveal mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Industry map</p>
              <h2 className="brand-display mt-3 text-4xl text-white">Where the operating model lands best</h2>
            </div>
            <Link href="/services" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              View all services
            </Link>
          </div>

          <div className="scroll-reveal grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ animationDelay: "0.1s" }}>
            {industries.map((industry, i) => {
              const accent = industryAccents[i % industryAccents.length];
              return (
                <article key={industry.name} className={`industry-card shine-card reveal-up stagger-${(i % 3) + 1}`}>
                  {/* gradient top accent */}
                  <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${accent.top} opacity-70`} />

                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-2xl">{accent.icon}</span>
                      <span className="cmd-text opacity-50">industry.{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="mt-3 text-xl font-bold text-white">{industry.name}</h3>
                    <div className="mt-2 signal-bar w-8" />
                    <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">{industry.summary}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── BOTTOM CTA ────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(38_92%_55%/.08),transparent_55%)]" />
          <div className="scroll-reveal relative z-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Your industry is next</p>
              <h2 className="brand-display mt-3 text-4xl text-white lg:text-5xl">
                Luxury doesn&apos;t mean vague. It means every niche gets a tailored operating logic.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">
                If your business has a repeatable intake flow, a lead pipeline, or a workflow
                that still requires too much manual intervention — there&apos;s a Blackspire
                system that can run it better.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <Link href="/contact" className="brand-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em] transition whitespace-nowrap">
                Book strategy call
              </Link>
              <Link href="/recon-engine" className="brand-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em] transition whitespace-nowrap">
                View Recon Engine
              </Link>
            </div>
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
