import Link from "next/link";
import type { CSSProperties } from "react";

import { DivisionWatermark } from "@/components/division-watermark";
import { HelixLawnIntakeDemo } from "@/components/helix-lawn-intake-demo";
import { EcosystemMark } from "@/components/ecosystem-mark";
import { MarketingShell } from "@/components/marketing-shell";
import { getProjectBySlug } from "@/lib/ecosystem";

const launchSteps = [
  {
    label: "Capture every lead",
    copy:
      "Modern quote requests, fast-loading pages, and form flows that make homeowners actually submit.",
  },
  {
    label: "Respond automatically",
    copy:
      "Instant text and email follow-up so prospects hear back before they call another lawn company.",
  },
  {
    label: "Route work clearly",
    copy:
      "Lead routing, CRM handoff, and operator dashboards that keep sales and field teams aligned.",
  },
  {
    label: "Scale without chaos",
    copy:
      "Reusable automation for estimates, reminder sequences, review requests, and repeat business loops.",
  },
] as const;

const outcomeCards = [
  "Higher quote-request conversion from the website",
  "Faster response time for inbound leads",
  "Less manual texting, emailing, and callback drag",
  "A stronger brand presence that looks bigger than the company size",
] as const;

const featureLanes = [
  {
    title: "Website engine",
    points: [
      "Luxury-feeling local service site design",
      "Offer framing for mowing, landscaping, installs, and maintenance",
      "Mobile-first quote-request experience",
    ],
  },
  {
    title: "Lead automation",
    points: [
      "Form capture into CRM or routing layer",
      "SMS and email follow-up sequences",
      "Fast qualification and service-area filtering",
    ],
  },
  {
    title: "Operations visibility",
    points: [
      "Lead-status awareness for operators",
      "Simple reporting surfaces for follow-up and close rate",
      "Cleaner handoff between office and crew scheduling",
    ],
  },
] as const;

const packageCards = [
  {
    name: "Launch",
    summary: "For local operators who need a better website and immediate lead-response lift.",
  },
  {
    name: "Growth",
    summary: "Adds automation, qualification flow, and stronger sales routing for busier teams.",
  },
  {
    name: "Command",
    summary: "A fuller operating system with dashboards, messaging flow, and higher-end brand execution.",
  },
] as const;

export function HelixLawnCommandPage() {
  const project = getProjectBySlug("helix-lawn-command");

  if (!project) return null;

  const projectStyle = {
    "--project-accent": project.accent,
    "--project-glow": project.glow,
    "--project-surface": project.surfaceTint,
    "--project-edge": project.edgeTint,
  } as CSSProperties;

  return (
    <MarketingShell watermarkLogoSrc={project.logoSrc} themeStyle={projectStyle}>
      <div className="theme-lawn-command mx-auto max-w-[1480px] px-4 py-10 lg:px-6" style={projectStyle}>
        <section className="brand-panel relative overflow-hidden px-6 py-8 lg:px-8 lg:py-10" style={projectStyle}>
          {project.logoSrc ? <DivisionWatermark logoSrc={project.logoSrc} /> : null}
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1fr_0.95fr] xl:items-center">
            <div className="space-y-7">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-3 rounded-full border border-[color:var(--project-edge)] bg-[color:var(--project-surface)] px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-white/90">
                  <span className="h-2 w-2 rounded-full bg-[var(--project-accent)] shadow-[0_0_18px_var(--project-glow)]" />
                  Lawn business automation
                </div>
                <div className="max-w-[340px]">
                  <EcosystemMark
                    name={project.name}
                    monogram={project.monogram}
                    logoSrc={project.logoSrc}
                    variant="bare"
                    logoMaxWidthClass={project.logoMaxWidthClass}
                    logoMaxHeightClass="max-h-[156px]"
                    logoStageClass={project.logoStageClass}
                  />
                </div>
                <h1 className="brand-display text-3xl leading-[1.04] text-white sm:text-4xl sm:leading-[0.96] lg:text-7xl lg:leading-[0.94]">
                  Premium websites, faster lead follow-up, and cleaner lawn-service growth systems.
                </h1>
                <p className="max-w-3xl text-base leading-8 text-[var(--copy-soft)]">
                  Helix Lawn Command is the Blackspire operating system for lawn care and landscaping
                  businesses that want to look sharper, respond faster, and convert more local leads
                  without running the office through pure manual chaos.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link href="/contact" className="project-button inline-flex px-5 py-4 text-sm transition">
                  Request launch plan
                </Link>
                <Link href="/services" className="project-button inline-flex px-5 py-4 text-sm transition">
                  Review automation scope
                </Link>
                <Link href="/workspace/helix-lawn-command" className="project-button inline-flex px-5 py-4 text-sm transition">
                  Open command center
                </Link>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Built for
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Lawn care, landscaping, maintenance, installs, and local service operators.
                  </div>
                </div>
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Core result
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Better quote flow, faster response, and more credible local brand presence.
                  </div>
                </div>
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Positioning
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Not generic agency work. A high-conversion service-business command system.
                  </div>
                </div>
              </div>
            </div>

            <div className="brand-panel project-hero-panel relative overflow-hidden px-6 py-8">
              <div className="project-hero-orb" />
              <div className="relative space-y-5">
                <div className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">
                  Local growth system
                </div>
                <h2 className="brand-display text-4xl leading-tight text-white">
                  A lawn business should feel organized, premium, and easy to buy from.
                </h2>
                <p className="text-sm leading-7 text-[var(--copy-soft)]">
                  The point is not just a nicer homepage. It is a full lead-conversion layer:
                  website, messaging, automation, and operator clarity, all designed for local
                  service businesses that are tired of losing work to delay.
                </p>
                <div className="grid gap-4">
                  {launchSteps.map((step, index) => (
                    <div key={step.label} className="project-detail-card flex gap-4 p-4">
                      <span className="project-accent-text text-2xl font-semibold">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className="text-base font-semibold text-white">{step.label}</div>
                        <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{step.copy}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-8" style={projectStyle}>
          <HelixLawnIntakeDemo />
        </div>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="brand-panel px-6 py-8" style={projectStyle}>
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">Why it matters</p>
            <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
              Most lawn companies don’t need more software first. They need a better system around demand.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              When inbound leads sit too long, websites look generic, and follow-up depends on someone
              remembering to text back, the business leaks revenue quietly. Helix Lawn Command exists to
              close those gaps with stronger experience design and better automation.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {outcomeCards.map((outcome) => (
              <div key={outcome} className="brand-card p-5" style={projectStyle}>
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Outcome
                </div>
                <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{outcome}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 brand-panel px-6 py-8" style={projectStyle}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">System lanes</p>
              <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
                Everything a local-service growth engine should handle.
              </h2>
            </div>
            <Link href="/contact" className="project-button inline-flex px-4 py-3 text-sm transition">
              Talk through your setup
            </Link>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {featureLanes.map((lane) => (
              <article key={lane.title} className="project-card brand-panel space-y-4 p-5" style={projectStyle}>
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  {lane.title}
                </div>
                <h3 className="text-2xl font-semibold text-white">{lane.title}</h3>
                <ul className="space-y-3 text-sm leading-6 text-[var(--copy-soft)]">
                  {lane.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--project-accent)]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
          <div className="brand-panel px-6 py-8" style={projectStyle}>
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">Offer shape</p>
            <div className="mt-5 grid gap-4">
              {packageCards.map((card) => (
                <div key={card.name} className="project-detail-card p-5">
                  <div className="project-detail-label">{card.name}</div>
                  <div className="mt-2 text-xl font-semibold text-white">{card.name}</div>
                  <div className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">{card.summary}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="brand-panel px-6 py-8" style={projectStyle}>
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">Best fit</p>
            <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
              Built for local operators who want to look premium and move faster.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Ideal for teams that already have demand but want a stronger front-end system for
              converting it: homeowners, property managers, recurring maintenance clients, and
              local landscaping opportunities that should not be slipping through the cracks.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <span className="project-pill">Quote requests</span>
              <span className="project-pill">SMS follow-up</span>
              <span className="project-pill">CRM routing</span>
              <span className="project-pill">Brand refresh</span>
              <span className="project-pill">Review loops</span>
            </div>
            <div className="mt-8 brand-card p-5">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                Next step
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                If you want, the next pass after this live landing page is wiring in a Lawn Command-specific
                intake flow so inbound leads can be segmented by service type, territory, urgency, and close potential.
              </p>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
