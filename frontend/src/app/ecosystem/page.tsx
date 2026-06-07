import type { Metadata } from "next";
import Link from "next/link";

import { EcosystemCard } from "@/components/ecosystem-card";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects } from "@/lib/ecosystem";

export const metadata: Metadata = {
  title: "Ecosystem | Blackspire Helix Group",
  description:
    "Explore the Blackspire Helix Group ecosystem, including live operator divisions and expanding product concepts under the parent brand.",
};

const liveProjects = ecosystemProjects.filter((project) => project.status === "live");
const buildingProjects = ecosystemProjects.filter((project) => project.status === "building");
const ecosystemLanes = [
  {
    id: "01",
    title: "Live operator divisions",
    copy: "Revenue-facing systems with working routes, branded identities, and clear audience fit.",
  },
  {
    id: "02",
    title: "Expanding concepts",
    copy: "Ideas that already belong to the Blackspire world but still need product shaping or go-to-market definition.",
  },
  {
    id: "03",
    title: "Parent-brand coherence",
    copy: "Each division can feel distinct without losing the shared command language of the flagship brand.",
  },
] as const;

export default function EcosystemPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-10 lg:px-6">
        <section className="brand-panel px-6 py-8 lg:px-8">
          <div className="grid gap-8 xl:grid-cols-[1fr_360px] xl:items-end">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Ecosystem Command</p>
              <h1 className="brand-display brand-accent-text mt-3 text-4xl leading-tight text-white lg:text-6xl">
                Blackspire Helix Group portfolio map.
              </h1>
              <p className="mt-5 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
                Every division belongs to one of two states: live operator surface or expanding concept.
                The ecosystem page keeps those lanes clear so the brand reads as organized instead of crowded.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Total</div>
                <div className="brand-display mt-2 text-3xl text-white">{String(ecosystemProjects.length).padStart(2, "0")}</div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Live</div>
                <div className="brand-display mt-2 text-3xl text-white">{String(liveProjects.length).padStart(2, "0")}</div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Building</div>
                <div className="brand-display mt-2 text-3xl text-white">{String(buildingProjects.length).padStart(2, "0")}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 brand-panel px-6 py-8 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Portfolio logic</p>
              <h2 className="brand-display mt-3 text-3xl text-white">How to read the ecosystem</h2>
            </div>
            <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Ask about a build lane
            </Link>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {ecosystemLanes.map((lane) => (
              <div key={lane.id} className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{lane.id}</div>
                <div className="mt-4 text-xl font-semibold text-white">{lane.title}</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{lane.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 brand-panel px-6 py-8 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Live systems</p>
              <h2 className="brand-display mt-3 text-3xl text-white">Active division surfaces</h2>
            </div>
            <Link href="/workspaces" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Open workspace directory
            </Link>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {liveProjects.map((project) => (
              <EcosystemCard key={project.slug} project={project} />
            ))}
          </div>
        </section>

        <section className="mt-6 brand-panel px-6 py-8 lg:px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Expanding systems</p>
            <h2 className="brand-display mt-3 text-3xl text-white">Concepts still forming under the parent brand</h2>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {buildingProjects.map((project) => (
              <EcosystemCard key={project.slug} project={project} />
            ))}
          </div>
        </section>

        <section className="mt-6 brand-panel px-6 py-8 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Next move</p>
              <h2 className="brand-display mt-3 text-3xl text-white">Need the public story or the operator layer?</h2>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Link href="/workspaces" className="brand-card block p-5 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">Operator access</div>
              <div className="mt-4 text-xl font-semibold text-white">Open workspace directory</div>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                Move from portfolio browsing into the live systems that already run the business logic.
              </p>
            </Link>
            <Link href="/contact" className="brand-card block p-5 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">Project intake</div>
              <div className="mt-4 text-xl font-semibold text-white">Start a branded system build</div>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                Use the intake brief if you want a division, command surface, or automation flow built with this same level of structure.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
