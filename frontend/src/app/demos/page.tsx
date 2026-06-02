import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects } from "@/lib/ecosystem";

const demoBuckets = [
  "Vertical reels and walkthrough clips",
  "Dashboard screenshots and command surfaces",
  "Workflow diagrams and operating logic",
  "Before and after automation examples",
] as const;

export default function DemosPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section className="brand-panel px-6 py-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Demo Gallery</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold">
            Proof, not just positioning.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            The next pass will attach real reels, screenshots, and workflow evidence per division. This page is already structured around that future proof library so the marketing site can mature without changing its shape.
          </p>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Content buckets</p>
            <div className="mt-5 grid gap-4">
              {demoBuckets.map((bucket) => (
                <div key={bucket} className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                  {bucket}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {ecosystemProjects.map((project) => (
              <article key={project.slug} className="brand-panel px-6 py-6">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--copy-muted)]">{project.role}</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{project.name}</h2>
                <p className="mt-4 text-sm leading-6 text-[var(--copy-soft)]">
                  Demo slots for {project.name} will collect project-specific reels, screenshots, workflows, and case-study proof.
                </p>
                <Link href={project.href} className="brand-button mt-5 inline-flex px-4 py-3 text-sm transition">
                  Open project overview
                </Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
