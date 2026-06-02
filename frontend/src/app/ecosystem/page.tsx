import type { CSSProperties } from "react";

import { EcosystemCard } from "@/components/ecosystem-card";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects } from "@/lib/ecosystem";

export default function EcosystemPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section className="brand-panel px-6 py-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Ecosystem</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold">
            One parent brand. Five specialized AI systems.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            BLACKSPIRE HELIX GROUP is designed as a command-center parent company. Each division proves how the same automation philosophy can be translated into a different market without losing precision.
          </p>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-5">
          {ecosystemProjects.map((project) => (
            <div
              key={project.slug}
              className="brand-panel px-4 py-4"
              style={
                {
                  "--project-accent": project.accent,
                  "--project-surface": project.surfaceTint,
                } as CSSProperties
              }
            >
              <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">
                {project.name}
              </div>
              <div className="mt-3 ecosystem-spectrum h-2 rounded-full" />
              <div className="mt-3 text-xs uppercase tracking-[0.22em] text-white/90">
                {project.vibe}
              </div>
            </div>
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {ecosystemProjects.map((project) => (
            <EcosystemCard key={project.slug} project={project} />
          ))}
        </section>
      </div>
    </MarketingShell>
  );
}
