import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { serviceLines, useCases } from "@/lib/ecosystem";

export const metadata: Metadata = {
  title: "Services | Blackspire Helix Group",
  description:
    "Review Blackspire Helix Group services across strategy, build engagements, operator upgrades, automation systems, and premium client-facing surfaces.",
};

const useCaseIcons = ["🎯", "📨", "🤝", "🎬", "💎", "📊"];

const useCaseAccents = [
  { color: "hsl(38 92% 55%)" },
  { color: "hsl(210 90% 60%)" },
  { color: "hsl(20 100% 55%)" },
  { color: "hsl(270 80% 62%)" },
  { color: "hsl(340 80% 60%)" },
  { color: "hsl(142 70% 45%)" },
];

const engagementModes = [
  {
    id: "01",
    title: "Strategy Call",
    tagline: "Architecture before build",
    copy: "Best when you need system architecture, positioning clarity, or a fast audit before build work starts. We map the problem, identify the automation gaps, and give you a prioritized build sequence.",
    cta: "Book strategy call",
    href: "/contact",
  },
  {
    id: "02",
    title: "Build Engagement",
    tagline: "Full-stack delivery",
    copy: "Best when you know the business problem and want the workflow, interface, and automation stack built cleanly. We scope, build, and hand off a running system.",
    cta: "Start build intake",
    href: "/contact",
  },
  {
    id: "03",
    title: "Operator Upgrade",
    tagline: "Elevate what's already built",
    copy: "Best when you have tools in place but the surface still feels fragmented, slow, or under-designed. We audit what exists and upgrade the pieces that limit your leverage.",
    cta: "Request upgrade audit",
    href: "/contact",
  },
] as const;

const serviceIcons = ["⚙️", "🛰️", "🎯", "📡", "🔬", "🏗️", "🔐", "📊"];

const decisionSignals = [
  {
    label: "Start with strategy",
    detail: "Best when the bottleneck is real but the right system shape is still unclear.",
  },
  {
    label: "Go straight to build",
    detail: "Best when the business problem is already obvious and you need the workflow shipped cleanly.",
  },
  {
    label: "Upgrade the current stack",
    detail: "Best when tools exist already but the operator experience still feels fragmented or underpowered.",
  },
] as const;

const deliverySequence = [
  {
    id: "01",
    title: "Clarify the bottleneck",
    copy: "We identify the revenue leak, workflow drag, or customer-facing gap that matters most right now.",
  },
  {
    id: "02",
    title: "Choose the build lane",
    copy: "Strategy, delivery, or upgrade so the scope matches the business stage instead of inflating into fluff.",
  },
  {
    id: "03",
    title: "Ship the operator layer",
    copy: "Interfaces, automations, and system logic come together as a working command surface, not a vague concept.",
  },
] as const;

export default function ServicesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6 space-y-8">

        {/* ── HERO ─────────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10 lg:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.11),transparent_65%)] blur-3xl" />
            <div className="absolute -bottom-16 left-1/3 h-60 w-60 rounded-full bg-[radial-gradient(circle,hsl(210_80%_60%/.07),transparent_65%)] blur-3xl" />
          </div>
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            <div>
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <p className="cmd-text">BLACKSPIRE HELIX GROUP / Service Architecture</p>
              </div>
              <h1 className="brand-accent-text mt-4 text-5xl font-black leading-none tracking-tight lg:text-7xl">
                AI EMPLOYEES.<br />
                <span className="text-white">BUILT TO SCALE.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--copy-soft)]">
                BLACKSPIRE HELIX GROUP translates automation into practical business leverage:
                more leads, faster follow-up, cleaner operations, and operators who feel
                unfairly well-armed.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/contact" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Start intake
                </Link>
                <Link href="/recon-engine" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  Explore Recon Engine
                </Link>
                <Link href="/demos" className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
                  See proof gallery
                </Link>
              </div>
            </div>
            {/* stat cluster */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: "8", label: "Service layers" },
                { value: "3", label: "Engagement modes" },
                { value: "24/7", label: "Automation uptime" },
                { value: "Elite", label: "Build standard" },
              ].map((s, i) => (
                <div key={s.label} className={`stat-badge reveal-scale stagger-${i + 1}`}>
                  <span className="stat-badge-value brand-accent-text">{s.value}</span>
                  <span className="stat-badge-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="brand-panel px-6 py-8 lg:px-10">
          <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Decision support</p>
              <h2 className="brand-display mt-3 text-4xl text-white">Choose the right engagement lane faster</h2>
            </div>
            <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Start project brief
            </Link>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {decisionSignals.map((signal, index) => (
              <div key={signal.label} className={`brand-card p-5 reveal-up stagger-${index + 1}`}>
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">
                  Signal {String(index + 1).padStart(2, "0")}
                </div>
                <div className="mt-4 text-xl font-semibold text-white">{signal.label}</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{signal.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── SERVICE LAYERS TIMELINE ───────────────────────────────── */}
        <section className="brand-panel px-6 py-10 lg:px-10">
          <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Core service layers</p>
              <h2 className="brand-display mt-3 text-4xl text-white">The build architecture behind every Blackspire engagement</h2>
            </div>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {serviceLines.map((service, index) => (
              <div key={service} className={`service-timeline-card shine-card reveal-up stagger-${(index % 4) + 1}`}>
                <div className="flex items-center gap-4">
                  <div className="service-icon-badge shrink-0">
                    <span className="text-2xl">{serviceIcons[index] ?? "⚡"}</span>
                  </div>
                  <span className="brand-accent-text text-3xl font-black leading-none">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="signal-bar h-[3px] flex-1" />
                </div>
                <p className="mt-4 text-[15px] leading-7 text-[var(--copy-soft)]">{service}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="glow-line" />

        {/* ── ENGAGEMENT MODES ──────────────────────────────────────── */}
        <section>
          <div className="scroll-reveal mb-6">
            <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Engagement modes</p>
            <h2 className="brand-display mt-3 text-4xl text-white">How we work with you</h2>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {engagementModes.map((mode, i) => (
              <article
                key={mode.id}
                className={`brand-panel relative overflow-hidden px-6 py-8 shine-card reveal-up stagger-${i + 1}`}
              >
                <div className="pointer-events-none absolute right-4 top-4 ghost-number text-[5rem] opacity-[0.05]">
                  {mode.id}
                </div>
                <div className="relative z-10 flex h-full flex-col gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--gold-soft)]">{mode.tagline}</p>
                    <h3 className="mt-2 text-2xl font-bold text-white">{mode.title}</h3>
                  </div>
                  <div className="signal-bar w-12" />
                  <p className="flex-1 text-sm leading-7 text-[var(--copy-soft)]">{mode.copy}</p>
                  <Link href={mode.href} className="brand-button mt-2 inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                    {mode.cta}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── USE CASE MATRIX ───────────────────────────────────────── */}
        <section className="brand-panel px-6 py-10 lg:px-10">
          <div className="scroll-reveal mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Use-case matrix</p>
              <h2 className="brand-display mt-3 text-4xl text-white">What we make AI employees do</h2>
            </div>
            <Link href="/industries" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              View industries
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {useCases.map((useCase, index) => {
              const accent = useCaseAccents[index % useCaseAccents.length];
              return (
                <div
                  key={useCase}
                  className="use-case-card shine-card"
                  style={{ "--uc-accent": accent.color } as CSSProperties}
                >
                  <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${accent.color}, transparent)` }} />
                  <div className="mb-4 flex items-center justify-between">
                    <span className="use-case-icon">{useCaseIcons[index] ?? "⚡"}</span>
                    <span className="cmd-text opacity-60">signal.{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="text-[15px] leading-7 text-white/90">{useCase}</p>
                  <div className="mt-4 signal-bar h-[3px] w-10" style={{ background: `linear-gradient(90deg, ${accent.color}, transparent)`, boxShadow: `0 0 10px ${accent.color}55` }} />
                </div>
              );
            })}
          </div>
        </section>

        <section className="brand-panel px-6 py-10 lg:px-10">
          <div className="scroll-reveal mb-6">
            <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Delivery sequence</p>
            <h2 className="brand-display mt-3 text-4xl text-white">How a Blackspire engagement actually moves</h2>
          </div>

          <div className="scroll-reveal grid gap-4 lg:grid-cols-3" style={{ animationDelay: "0.1s" }}>
            {deliverySequence.map((step) => (
              <article key={step.id} className="brand-card card-lift p-5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--gold)]">{step.id}</span>
                  <div className="signal-bar h-px flex-1" />
                </div>
                <h3 className="mt-4 text-xl font-semibold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 h-60 w-60 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.1),transparent_65%)] blur-3xl" />
          </div>
          <div className="scroll-reveal relative z-10 text-center max-w-3xl mx-auto">
            <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Ready to build</p>
            <h2 className="brand-display mt-3 text-4xl text-white lg:text-5xl">
              Tell us what needs to run better.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Strategy calls, AI-readiness intake, operator dashboards, lead routing, and branded
              product surfaces — all under one flagship command identity.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/contact" className="brand-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em] transition">
                Book strategy call
              </Link>
              <Link href="/recon-engine" className="brand-button inline-flex px-7 py-4 text-sm uppercase tracking-[0.18em] transition">
                See Recon Engine
              </Link>
            </div>
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
