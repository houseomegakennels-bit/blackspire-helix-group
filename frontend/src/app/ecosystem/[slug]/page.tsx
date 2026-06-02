import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { EcosystemCard } from "@/components/ecosystem-card";
import { HelixLawnCommandPage } from "@/components/helix-lawn-command-page";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects, getProjectBySlug } from "@/lib/ecosystem";

export function generateStaticParams() {
  return ecosystemProjects.map((project) => ({ slug: project.slug }));
}

export default async function EcosystemProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);

  if (!project) {
    notFound();
  }

  if (project.slug === "helix-lawn-command") {
    return <HelixLawnCommandPage />;
  }

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section
          className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]"
          style={
            {
              "--project-accent": project.accent,
              "--project-glow": project.glow,
              "--project-surface": project.surfaceTint,
              "--project-edge": project.edgeTint,
            } as CSSProperties
          }
        >
          <EcosystemCard project={project} mode="stacked" />

          <div className="space-y-6">
            <section className="brand-panel project-hero-panel overflow-hidden px-6 py-8">
              <div className="project-hero-orb" />
              <p className="relative text-xs uppercase tracking-[0.42em] text-white/85">
                {project.role}
              </p>
              <h1 className="project-accent-text relative mt-3 text-4xl font-semibold">{project.name}</h1>
              <p className="project-lead relative mt-3 max-w-3xl text-lg leading-8">
                {project.tagline}
              </p>
              <p className="relative mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                {project.description}
              </p>
              <div className="relative mt-5 grid gap-4 md:grid-cols-3">
                <div className="project-detail-card p-4">
                  <div className="project-detail-label">Motif</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{project.motif}</div>
                </div>
                <div className="project-detail-card p-4">
                  <div className="project-detail-label">Signal</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{project.iconCue}</div>
                </div>
                <div className="project-detail-card p-4">
                  <div className="project-detail-label">Vibe</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{project.vibe}</div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                {project.productHref ? (
                  <Link href={project.productHref} className="project-button inline-flex px-4 py-3 text-sm transition">
                    Open live workspace
                  </Link>
                ) : null}
                <Link href="/contact" className="project-button inline-flex px-4 py-3 text-sm transition">
                  Start a strategy call
                </Link>
              </div>
            </section>

            <section className="grid gap-6 md:grid-cols-2">
              <div className="brand-panel project-detail-card px-6 py-6">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Target user
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{project.targetUser}</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
                  This division exists to translate the Blackspire operating model into a market-specific system with clearer workflows and better outcomes.
                </p>
              </div>

              <div className="brand-panel project-detail-card px-6 py-6">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Primary outcome
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{project.primaryOutcome}</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
                  The focus is not generic AI. It is specific business leverage: cleaner intake, faster action, and less manual drag.
                </p>
              </div>
            </section>

            <section className="brand-panel project-detail-card px-6 py-8">
              <p className="text-xs uppercase tracking-[0.36em] text-white/85">System shape</p>
              <div className="mt-5 grid gap-4">
                {project.featureBullets.map((bullet) => (
                  <div key={bullet} className="project-detail-card flex gap-3 p-4">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--project-accent)]" />
                    <p className="text-sm leading-6 text-[var(--copy-soft)]">{bullet}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
