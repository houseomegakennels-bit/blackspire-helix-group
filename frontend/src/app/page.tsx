import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

import { EcosystemCard } from "@/components/ecosystem-card";
import { MarketingShell } from "@/components/marketing-shell";
import {
  ecosystemProjects,
  industries,
  parentBrand,
  serviceLines,
  useCases,
} from "@/lib/ecosystem";

export default function Home() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-12 lg:px-6 lg:py-16">
        <section className="brand-panel overflow-hidden px-6 py-10 lg:px-8 lg:py-12">
          <div className="grid gap-10 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="max-w-[360px]">
                  <Image
                    src="/brand/blackspire-helix-group-logo.png"
                    alt="BLACKSPIRE HELIX GROUP logo"
                    width={1792}
                    height={1024}
                    priority
                    className="h-auto w-auto max-w-full object-contain"
                  />
                </div>
                <h1 className="brand-accent-text max-w-4xl text-5xl font-semibold leading-[1.04] lg:text-6xl">
                  Build AI Employees That Work 24/7
                </h1>
                <p className="max-w-3xl text-base leading-8 text-[var(--copy-soft)]">
                  {parentBrand.description}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link href="/contact" className="brand-button inline-flex px-5 py-4 text-sm transition">
                  Book Strategy Call
                </Link>
                <Link href="/ecosystem" className="brand-button inline-flex px-5 py-4 text-sm transition">
                  Explore Ecosystem
                </Link>
                <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-5 py-4 text-sm transition">
                  Open Buyer Engine Workspace
                </Link>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Positioning
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Premium AI command center, not a generic chatbot agency.
                  </div>
                </div>
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Focus
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Leads, follow-up, operations, content, dashboards, and workflow routing.
                  </div>
                </div>
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Outcome
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                    Less manual drag. Faster response. Cleaner systems.
                  </div>
                </div>
              </div>
            </div>

            <div className="brand-panel relative overflow-hidden px-6 py-8">
              <div className="brand-orb brand-orb-gold" />
              <div className="brand-orb brand-orb-silver" />
              <div className="relative space-y-5">
                <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">
                  Command Center Thesis
                </p>
                <h2 className="text-3xl font-semibold text-white">
                  One master identity. Multiple specialized divisions.
                </h2>
                <p className="text-sm leading-7 text-[var(--copy-soft)]">
                  The ecosystem is the proof. Each division demonstrates how BLACKSPIRE HELIX GROUP can turn the same automation philosophy into a niche operating system.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ecosystemProjects.map((project) => (
                    <div
                      key={project.slug}
                      className="ecosystem-preview-card p-4"
                      style={
                        {
                          "--project-accent": project.accent,
                          "--project-surface": project.surfaceTint,
                        } as CSSProperties
                      }
                    >
                      <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                        {project.role}
                      </div>
                      <div className="mt-2 text-base font-semibold text-white">{project.name}</div>
                      <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{project.primaryOutcome}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">The problem</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">
              Missed leads, slow follow-up, and scattered tools quietly cost businesses money.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Most businesses do not need more disconnected software. They need one system that can capture intent, move information, trigger action, and show operators what matters.
            </p>
          </div>

          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">The solution</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {serviceLines.map((service) => (
                <div key={service} className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                  {service}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 brand-panel px-6 py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Ecosystem divisions</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">
                Five proof points under one parent brand.
              </h2>
            </div>
            <Link href="/ecosystem" className="brand-button inline-flex px-4 py-3 text-sm transition">
              View full ecosystem
            </Link>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {ecosystemProjects.map((project) => (
              <EcosystemCard key={project.slug} project={project} />
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">How it works</p>
            <div className="mt-5 grid gap-4">
              {["Discover", "Design", "Build", "Automate", "Optimize"].map((step, index) => (
                <div key={step} className="brand-card flex items-center gap-4 p-4">
                  <span className="brand-accent-text text-2xl font-semibold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="text-base font-semibold text-white">{step}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">
                      Move from business friction to a system that can actually run.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">AI employee use cases</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {useCases.map((useCase) => (
                <div key={useCase} className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                  {useCase}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Industry fit</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {industries.map((industry) => (
                <div key={industry.name} className="brand-card p-4">
                  <div className="text-base font-semibold text-white">{industry.name}</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{industry.summary}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Founder vision</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">
              A portfolio of niche AI-powered business systems.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              The parent brand exists to make the entire ecosystem legible: one operating philosophy, multiple vertical applications, and room for each division to become a serious product in its own right.
            </p>
            <Link href="/about" className="brand-button mt-6 inline-flex px-4 py-3 text-sm transition">
              Read the founder thesis
            </Link>
          </div>
        </section>

        <section className="mt-8 brand-panel px-6 py-8">
          <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Final CTA</p>
          <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold text-white">Tell us what you want automated.</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                The contact surface is now in place for strategy calls and AI-readiness intake. Next we can wire the form directly into n8n and your lead-routing stack.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/contact" className="brand-button inline-flex px-5 py-4 text-sm transition">
                Start intake
              </Link>
              <Link href="/demos" className="brand-button inline-flex px-5 py-4 text-sm transition">
                Review demo plan
              </Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
