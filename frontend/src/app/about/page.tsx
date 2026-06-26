import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "About | Blackspire Helix Group",
  description:
    "Meet the founder behind Blackspire Helix Group and the principles guiding its AI employees, operator systems, and long-term brand vision.",
};

const brandPrinciples = [
  "We build AI employees that do real work — not demos that only impress in a meeting.",
  "Every client gets leverage: more leads, faster follow-up, and cleaner operations.",
  "One trusted partner across every industry we serve — never a generic agency.",
] as const;

const founderGoals = [
  "Financial Freedom",
  "Time Freedom",
  "Help Others",
  "Legacy",
] as const;

const founderPlan = [
  "Goals",
  "Discipline",
  "Consistency",
  "Time & Focus",
  "Financial Freedom",
] as const;

const companyOutcomes = [
  {
    label: "What clients get",
    value: "More leverage",
    detail: "Cleaner operations, faster response time, stronger follow-up, and systems that keep working after the call ends.",
  },
  {
    label: "What the brand protects",
    value: "Clarity over noise",
    detail: "Each division can feel distinct and premium without collapsing into generic agency language or AI hype.",
  },
] as const;

const founderTimeline = [
  {
    id: "01",
    title: "See the bottleneck clearly",
    copy: "The work starts by noticing where time, attention, and money leak out of a business every day.",
  },
  {
    id: "02",
    title: "Build the operator advantage",
    copy: "That bottleneck becomes a system: lead routing, automation, dashboards, or a branded division surface that changes how the business runs.",
  },
  {
    id: "03",
    title: "Create freedom through structure",
    copy: "The end goal is not software for its own sake. It is more control, more time, and more room to build a lasting life.",
  },
] as const;

export default function AboutPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] space-y-8 px-4 py-16 lg:px-6">

        {/* ── Meet the Founder ─────────────────────────────────────────── */}
        <section className="brand-panel overflow-hidden px-6 py-10 lg:px-10">
          {/* Background orbs */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -right-12 -top-12 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.12),transparent_65%)] blur-3xl" />
            <div className="absolute -bottom-16 -left-8 h-56 w-56 rounded-full bg-[radial-gradient(circle,hsl(198_100%_70%/.07),transparent_65%)] blur-3xl" />
            <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.04),transparent_65%)] blur-3xl" />
          </div>

          <div className="flex items-center gap-3">
            <span className="live-dot" />
            <p className="cmd-text">BLACKSPIRE HELIX GROUP / Founder Profile</p>
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.12fr] xl:gap-12">

            {/* Left — founder photo */}
            <div className="reveal-scale relative">
              <div className="brand-card shine-card overflow-hidden p-2">
                <Image
                  src="/brand/carlos-pearson-founder.jpg"
                  alt="Carlos Pearson — Founder & Owner of Blackspire Helix Group"
                  width={900}
                  height={1100}
                  className="w-full rounded-[18px] object-cover object-top"
                  priority
                />
              </div>
              {/* CEO badge */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                <span className="rounded-full border border-[var(--gold)] bg-[hsl(0_0%_4%/.85)] px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-[var(--gold)] backdrop-blur-sm">
                  CEO of My Life
                </span>
              </div>
            </div>

            {/* Right — name, title, bio, stats */}
            <div className="flex flex-col justify-center gap-6">

              {/* Name block */}
              <div className="reveal-left">
                <h1 className="brand-accent-text text-5xl font-black leading-none tracking-tight lg:text-6xl xl:text-7xl">
                  CARLOS<br />PEARSON
                </h1>
                <p className="mt-3 text-xs uppercase tracking-[0.34em] text-[var(--copy-muted)]">
                  Founder &amp; Owner of{" "}
                  <span className="text-[var(--gold-soft)]">Blackspire Helix Group</span>
                </p>
                <div className="mt-3 h-[2px] w-16 bg-[var(--gold)]" />
              </div>

              {/* Bio cards */}
              <div className="grid gap-3 reveal-up stagger-2">
                <div className="brand-card shine-card p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 text-[var(--gold)] shrink-0">⚙️</span>
                    <p className="text-sm leading-7 text-[var(--copy-soft)]">
                      Carlos Pearson is the founder and owner of{" "}
                      <span className="font-semibold text-[var(--gold-soft)]">BLACKSPIRE HELIX GROUP</span>
                      {" "}— a modern technology and digital innovation company focused on automation,
                      AI systems, branding, real estate intelligence, and next-generation business
                      infrastructure.
                    </p>
                  </div>
                </div>
                <div className="brand-card shine-card p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 text-[var(--gold)] shrink-0">🚀</span>
                    <p className="text-sm leading-7 text-[var(--copy-soft)]">
                      Known for blending creativity with technology, Carlos built{" "}
                      <span className="font-semibold text-[var(--gold-soft)]">BLACKSPIRE HELIX GROUP</span>
                      {" "}with the vision of helping businesses and entrepreneurs operate smarter,
                      move faster, and compete at a higher level in the digital era.
                    </p>
                  </div>
                </div>
              </div>

              {/* Goals + Plan side-by-side */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="brand-card p-5">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--copy-muted)]">Goals</p>
                  <ul className="mt-3 space-y-1.5">
                    {founderGoals.map((g) => (
                      <li key={g} className="flex items-center gap-2 text-sm text-[var(--copy-soft)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] shrink-0" />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="brand-card p-5">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--copy-muted)]">The Plan</p>
                  <ol className="mt-3 space-y-1.5">
                    {founderPlan.map((step, i) => (
                      <li key={step} className="flex items-center gap-2 text-sm text-[var(--copy-soft)]">
                        <span className="text-[10px] font-bold text-[var(--gold)]">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Mantras row */}
              <div className="flex flex-wrap gap-2">
                {["Faith · Focus · Finish", "Discipline · Grind · Success", "Sacrifice Today · Freedom Tomorrow"].map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]"
                  >
                    {m}
                  </span>
                ))}
              </div>

              {/* CTA */}
              <div className="flex flex-wrap gap-3">
                <Link href="/recon-engine" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  View Recon Engine
                </Link>
                <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Tour the ecosystem
                </Link>
                <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Work with us
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 scroll-reveal">
          {companyOutcomes.map((outcome) => (
            <article key={outcome.label} className="brand-panel card-lift px-6 py-8">
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">{outcome.label}</p>
              <h2 className="brand-display mt-3 text-3xl text-white">{outcome.value}</h2>
              <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">{outcome.detail}</p>
            </article>
          ))}
        </section>

        {/* glow divider */}
        <div className="glow-line" />

        {/* ── Founder Vision + Brand Philosophy ───────────────────────── */}
        <section className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
          <article className="brand-panel px-6 py-8 reveal-up">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Founder vision</p>
            <div className="mt-5 grid gap-4">
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                Blackspire Helix Group exists to give everyday businesses the kind of automation
                and infrastructure that used to belong only to large companies — so they can
                compete and win without hiring an army.
              </div>
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                We put AI to work on the repetitive tasks that drain time and money — capturing
                leads, following up fast, and keeping operations clean — so owners can focus on
                growth, family, and the life they&apos;re building.
              </div>
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                We&apos;re building a lasting company rooted in faith, discipline, and integrity —
                one that creates real freedom for our clients and a legacy worth leaving behind.
              </div>
            </div>
          </article>

          <article className="brand-panel shine-card px-6 py-8 reveal-up stagger-2">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">What we stand for</p>
                <h2 className="brand-display mt-3 text-3xl text-white">The standards we hold on every build</h2>
              </div>
            </div>
            <div className="mt-6 grid gap-4">
              {brandPrinciples.map((principle) => (
                <div key={principle} className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                  {principle}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/recon-engine" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Explore Recon Engine
              </Link>
              <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review ecosystem
              </Link>
              <Link href="/demos" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review proof gallery
              </Link>
            </div>
          </article>
        </section>

        <section className="brand-panel px-6 py-8 lg:px-10">
          <div className="scroll-reveal flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Why this company exists</p>
              <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">The founder story becomes the operating standard</h2>
            </div>
            <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Start a conversation
            </Link>
          </div>

          <div className="scroll-reveal mt-6 grid gap-4 lg:grid-cols-3" style={{ animationDelay: "0.1s" }}>
            {founderTimeline.map((step) => (
              <article key={step.id} className="brand-card card-lift p-5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--gold)]">{step.id}</span>
                  <div className="signal-bar h-px flex-1" />
                </div>
                <h3 className="mt-4 text-xl font-semibold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
