import Link from "next/link";
import type { CSSProperties } from "react";

import { EcosystemMark } from "@/components/ecosystem-mark";
import type { EcosystemProject } from "@/lib/ecosystem";

export function EcosystemCard({
  project,
  mode = "grid",
}: {
  project: EcosystemProject;
  mode?: "grid" | "stacked";
}) {
  return (
    <article
      className={`project-card brand-panel h-full p-5 ${mode === "stacked" ? "space-y-5" : "space-y-4"}`}
      style={
        {
          "--project-accent": project.accent,
          "--project-glow": project.glow,
          "--project-surface": project.surfaceTint,
          "--project-edge": project.edgeTint,
        } as CSSProperties
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
          {project.role}
        </p>
        <span className="project-pill">
          {project.status === "live" ? "live surface" : "expanding system"}
        </span>
      </div>

      <EcosystemMark
        name={project.name}
        monogram={project.monogram}
        logoSrc={project.logoSrc}
        variant={mode === "stacked" ? "hero" : "framed"}
        logoMaxWidthClass={project.logoMaxWidthClass}
        logoMaxHeightClass={project.logoMaxHeightClass}
      />

      <div className="space-y-3">
        <div>
          <h3 className="text-xl font-semibold text-white">{project.name}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
            {project.tagline}
          </p>
        </div>
        <p className="text-sm leading-6 text-[var(--copy-soft)]">
          {project.description}
        </p>
      </div>

      <div className="project-signal text-xs uppercase tracking-[0.24em]">
        <span className="project-signal-label">{project.iconCue}</span>
        <span className="project-signal-separator" aria-hidden="true">
          /
        </span>
        <span className="project-signal-copy">{project.vibe}</span>
      </div>

      <div className="grid gap-3 text-sm text-[var(--copy-soft)]">
        <div className="project-metric">
          <span className="project-metric-label">Target user</span>
          <span>{project.targetUser}</span>
        </div>
        <div className="project-metric">
          <span className="project-metric-label">Outcome</span>
          <span>{project.primaryOutcome}</span>
        </div>
      </div>

      <ul className="space-y-2 text-sm leading-6 text-[var(--copy-soft)]">
        {project.featureBullets.map((bullet) => (
          <li key={bullet} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--project-accent)]" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <div className="project-motif text-sm leading-6 text-[var(--copy-soft)]">
        {project.motif}
      </div>

      <div className="flex flex-wrap gap-3 pt-1">
        <Link href={project.href} className="project-button inline-flex px-4 py-3 text-sm transition">
          {project.cta}
        </Link>
        {project.productHref ? (
          <Link href={project.productHref} className="project-button inline-flex px-4 py-3 text-sm transition">
            Open workspace
          </Link>
        ) : null}
      </div>
    </article>
  );
}
