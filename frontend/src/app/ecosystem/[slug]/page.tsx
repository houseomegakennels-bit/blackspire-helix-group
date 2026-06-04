import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HelixLawnCommandPage } from "@/components/helix-lawn-command-page";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects, getProjectBySlug } from "@/lib/ecosystem";

const THEME_CLASSES: Record<string, string> = {
  "recon-engine": "theme-recon-engine",
  "buyer-engine": "theme-buyer-engine",
  "deal-engine": "theme-deal-engine",
  "seller-engine": "theme-seller-engine",
  "helix-lawn-command": "theme-lawn-command",
  "social-os": "theme-social-os",
  "ember-halo": "theme-ember-halo",
  "oracle-helix": "theme-oracle-helix",
};

export function generateStaticParams() {
  return ecosystemProjects.map((p) => ({ slug: p.slug }));
}

export default async function EcosystemProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);

  if (!project) notFound();
  if (project.slug === "helix-lawn-command") return <HelixLawnCommandPage />;

  const themeClass = THEME_CLASSES[slug] ?? "";

  const projectStyle = {
    "--project-accent": project.accent,
    "--project-glow": project.glow,
    "--project-surface": project.surfaceTint,
    "--project-edge": project.edgeTint,
  } as CSSProperties;

  return (
    <MarketingShell>
      <div className={`division-page ${themeClass}`} style={projectStyle}>
        {project.logoSrc ? (
          <div className="division-watermark" aria-hidden="true">
            <Image
              src={project.logoSrc}
              alt=""
              width={1200}
              height={1200}
              className="division-watermark-img"
            />
          </div>
        ) : null}

        {/* ── HERO ────────────────────────────────────────────────────── */}
        <section className="division-hero relative overflow-hidden">
          {/* Division-specific animated background motif */}
          <div className="division-motif-canvas" aria-hidden="true">
            <div className="motif-center-glow" />
            <div className="motif-ring motif-ring-1" />
            <div className="motif-ring motif-ring-2" />
            <div className="motif-ring motif-ring-3" />
            <div className="motif-sweep" />
            <div className="motif-grid" />
          </div>

          <div className="relative z-10 mx-auto max-w-[1400px] px-4 py-20 lg:px-6 xl:py-28">
            <div className="grid gap-10 xl:grid-cols-[1fr_340px] xl:items-center">

              {/* ── Text content ── */}
              <div>
                <div className="flex items-center gap-3">
                  {project.status === "live" ? (
                    <span className="live-dot" />
                  ) : (
                    <span className="division-building-dot" />
                  )}
                  <p className="cmd-text">
                    {project.status === "live" ? "Live Division" : "In Development"}&nbsp;/&nbsp;BLACKSPIRE HELIX GROUP
                  </p>
                </div>

                <p className="mt-5 text-[11px] uppercase tracking-[0.44em] brand-accent-text">
                  {project.role}
                </p>
                <h1 className="mt-2 text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  {project.name}
                </h1>
                <p className="mt-4 max-w-xl text-base font-medium leading-8 brand-accent-text">
                  {project.tagline}
                </p>
                <p className="mt-3 max-w-xl text-sm leading-8 text-[var(--copy-soft)]">
                  {project.description}
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  {project.productHref && (
                    <Link
                      href={project.productHref}
                      className="brand-button inline-flex px-6 py-3 text-sm uppercase tracking-[0.18em] transition"
                    >
                      Open workspace
                    </Link>
                  )}
                  <Link
                    href="/contact"
                    className="brand-button inline-flex px-6 py-3 text-sm uppercase tracking-[0.18em] transition"
                  >
                    Start a strategy call
                  </Link>
                </div>
              </div>

              {/* ── Logo ── */}
              {project.logoSrc && (
                <div className="division-logo-frame hidden xl:flex items-center justify-center">
                  <Image
                    src={project.logoSrc}
                    alt={`${project.name} logo`}
                    width={320}
                    height={200}
                    className={`object-contain ${project.logoMaxWidthClass ?? "max-w-[260px]"} ${project.logoMaxHeightClass ?? "max-h-[160px]"}`}
                    priority
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── GLOW DIVIDER ─────────────────────────────────────────────── */}
        <div className="glow-line" />

        {/* ── CAPABILITIES ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.42em] brand-accent-text">System shape</p>
              <h2 className="brand-display mt-2 text-3xl text-white">Core capabilities</h2>
            </div>
            <div
              className="h-px flex-1 min-w-[40px] max-w-[200px]"
              style={{ background: "linear-gradient(90deg, var(--project-accent), transparent)" }}
            />
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {project.featureBullets.map((bullet, i) => (
              <div
                key={bullet}
                className={`brand-panel division-capability-card p-6 reveal-up stagger-${i + 1}`}
              >
                <div
                  className="mb-4 h-px w-10"
                  style={{ background: `linear-gradient(90deg, var(--project-accent), transparent)` }}
                />
                <p className="text-sm leading-7 text-[var(--copy-soft)]">{bullet}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── DETAILS ───────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1400px] px-4 pb-12 lg:px-6">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <div className="brand-panel division-detail-card p-6">
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Target User</p>
              <p className="mt-3 text-lg font-semibold text-white leading-tight">{project.targetUser}</p>
            </div>
            <div className="brand-panel division-detail-card p-6">
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Primary Outcome</p>
              <p className="mt-3 text-base font-semibold text-white leading-tight">{project.primaryOutcome}</p>
            </div>
            <div className="brand-panel division-detail-card p-6">
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Visual Motif</p>
              <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{project.motif}</p>
            </div>
            <div className="brand-panel division-detail-card p-6">
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Division Vibe</p>
              <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{project.vibe}</p>
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1400px] px-4 pb-20 lg:px-6">
          <div className="brand-panel division-cta-panel relative overflow-hidden px-8 py-14 text-center">
            <div className="division-cta-glow" aria-hidden="true" />
            <p className="relative z-10 cmd-text">Ready to deploy?</p>
            <h2 className="relative z-10 brand-display mt-3 text-3xl text-white sm:text-4xl lg:text-5xl">
              {project.cta}
            </h2>
            <div className="relative z-10 mt-6 flex flex-wrap justify-center gap-3">
              {project.productHref && (
                <Link
                  href={project.productHref}
                  className="brand-button inline-flex px-8 py-4 text-sm uppercase tracking-[0.2em] transition"
                >
                  Open workspace
                </Link>
              )}
              <Link
                href="/contact"
                className="brand-button inline-flex px-8 py-4 text-sm uppercase tracking-[0.2em] transition"
              >
                Start a strategy call
              </Link>
            </div>
          </div>
        </section>

      </div>
    </MarketingShell>
  );
}
