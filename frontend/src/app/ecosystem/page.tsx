import type { CSSProperties } from "react";
import Link from "next/link";

import { EcosystemCard } from "@/components/ecosystem-card";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects } from "@/lib/ecosystem";

const divisionColors = [
  { seg: "bg-[hsl(258_90%_66%)]", label: "Blackspire Recon Engine", delay: "0s" },
  { seg: "bg-[hsl(38_92%_55%)]", label: "Helix Lawn Command", delay: "0.3s" },
  { seg: "bg-[hsl(270_80%_62%)]", label: "Blackspire Social OS", delay: "0.6s" },
  { seg: "bg-[hsl(20_100%_55%)]", label: "Blackspire Buyer Engine", delay: "0.9s" },
  { seg: "bg-[hsl(340_80%_60%)]", label: "Ember Halo", delay: "1.2s" },
  { seg: "bg-[hsl(210_90%_60%)]", label: "Oracle Helix", delay: "1.5s" },
];

const commandStatsBase = [
  { value: "24/7", label: "Automation uptime" },
  { value: "56+", label: "Counties indexed" },
  { value: "Elite", label: "Operator posture" },
];

export default function EcosystemPage() {
  const systemCount = String(ecosystemProjects.length).padStart(2, "0");
  const commandStats = [
    { value: systemCount, label: "Active divisions" },
    ...commandStatsBase,
  ];

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6">

        {/* ── HERO ───────────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10 lg:py-16">
          {/* background orbs */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.14),transparent_68%)] blur-3xl" />
            <div className="absolute -bottom-16 -left-16 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(210_90%_60%/.08),transparent_68%)] blur-3xl" />
          </div>

          <div className="relative z-10 grid gap-10 xl:grid-cols-[1fr_auto] xl:items-end">
            <div>
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <p className="cmd-text">BLACKSPIRE HELIX GROUP / Ecosystem Command</p>
              </div>
              <h1 className="brand-accent-text mt-4 text-5xl font-black leading-none tracking-tight lg:text-7xl">
                ONE PARENT.<br />
                <span className="text-white">{systemCount} SYSTEMS.</span>
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--copy-soft)]">
                BLACKSPIRE HELIX GROUP operates as a command-center holding company. Each division
                proves how the same automation philosophy translates into a different market without
                losing precision, polish, or brand coherence.
              </p>

              {/* division color spectrum */}
              <div className="mt-8 space-y-2">
                <p className="text-[10px] uppercase tracking-[0.36em] text-[var(--copy-muted)]">Division spectrum</p>
                <div className="division-strip h-2">
                  {divisionColors.map((d) => (
                    <div
                      key={d.label}
                      className={`division-strip-seg ${d.seg}`}
                      style={{ animationDelay: d.delay }}
                    />
                  ))}
                </div>
                <div className="flex gap-0">
                  {divisionColors.map((d) => (
                    <div key={d.label} className="flex-1 text-center text-[9px] uppercase tracking-[0.16em] text-[var(--copy-muted)] leading-4 px-1">
                      {d.label.split(" ").slice(-1)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* stat badges */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
              {commandStats.map((s, i) => (
                <div key={s.label} className={`stat-badge reveal-up stagger-${i + 1}`}>
                  <span className="stat-badge-value brand-accent-text">{s.value}</span>
                  <span className="stat-badge-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DIVISION QUICK-NAV ─────────────────────────────────────── */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ecosystemProjects.map((project, i) => (
            <div
              key={project.slug}
              className={`brand-card shine-card cursor-default overflow-hidden p-4 reveal-up stagger-${i + 1}`}
              style={{ "--project-accent": project.accent } as CSSProperties}
            >
              <div
                className="mb-2 h-1 w-full rounded-full opacity-80"
                style={{ background: `linear-gradient(90deg, ${project.accent}, transparent)` }}
              />
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{project.role}</p>
              <p className="mt-1 text-sm font-semibold text-white leading-tight">{project.name}</p>
              <p className="mt-1.5 text-[11px] leading-5 text-[var(--copy-soft)] line-clamp-2">{project.tagline}</p>
              <div className="mt-3 flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: project.accent }}
                />
                <span className="text-[10px] uppercase tracking-[0.22em]"
                  style={{ color: project.accent }}>
                  {project.status === "live" ? "Live" : "Expanding"}
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* glow divider */}
        <div className="glow-line my-8" />

        {/* ── FULL DIVISION CARDS ────────────────────────────────────── */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Division Dossiers</p>
              <h2 className="brand-display mt-2 text-4xl text-white">Full command profiles</h2>
            </div>
            <Link href="/services" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              View services map
            </Link>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {ecosystemProjects.map((project, i) => (
              <div key={project.slug} className={`reveal-up stagger-${(i % 3) + 1}`}>
                <EcosystemCard project={project} />
              </div>
            ))}
          </div>
        </section>

        {/* ── COMMAND ARCHITECTURE ───────────────────────────────────── */}
        <section className="mt-8 brand-panel relative overflow-hidden px-6 py-10 lg:px-10">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_80%_20%,hsl(38_92%_55%/.06),transparent_60%)]" />
          <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Command architecture</p>
              <h2 className="brand-display mt-3 text-4xl text-white leading-tight">
                One operating philosophy.<br />Infinite vertical translations.
              </h2>
              <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
                BLACKSPIRE HELIX GROUP is not positioned like a template-heavy AI agency.
                The parent experience telegraphs discretion, engineering depth, and founder taste.
                Every division below is proof that the same operating philosophy can be translated
                into a different market with its own visual language and revenue logic.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/about" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Meet the founder
                </Link>
                <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Start a project
                </Link>
              </div>
            </div>
            <div className="grid gap-3">
              {["Luxury brand language across every surface", "Operator-first interfaces with command-grade UX", "Verticalized AI systems per industry", "Automation that runs without hand-holding"].map((item, i) => (
                <div key={item} className={`service-timeline-card reveal-left stagger-${i + 1}`}>
                  <span className="ghost-number absolute right-3 -top-2 text-4xl opacity-[0.07]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-sm font-medium text-white tracking-[0.04em]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
