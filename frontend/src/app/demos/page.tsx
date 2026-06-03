import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects } from "@/lib/ecosystem";

const proofLanes = [
  "Launch reels and cinematic walkthrough clips",
  "Dashboard screenshots and command-surface captures",
  "Workflow logic maps and operating sequences",
  "Before/after proof tied to real business outcomes",
] as const;

const featuredDemoSlots = [
  {
    id: "01",
    title: "Blackspire Buyer Engine Demo",
    summary:
      "A live walkthrough of the Buyer Engine command surface, showing how the Blackspire product layer turns buyer intelligence into a premium operator experience.",
    src: "/demos/buyer-engine-demo-final.mp4",
    badge: "Flagship workflow",
  },
  {
    id: "02",
    title: "Helix Lawn Command Demo",
    summary:
      "Helix Lawn Command in action: AI captures every missed lawn-care call and web inquiry 24/7, qualifies the lead, and turns it into a booked $150-$1,500 job before it ever goes cold.",
    src: "/demos/elevenlabs-lovable-demo.mp4",
    badge: "Lawn automation",
  },
] as const;

export default function DemosPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6">
        <section className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[34%] bg-[radial-gradient(circle_at_center,hsl(198_100%_70%/.08),transparent_72%)]" />
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Demo Gallery</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold lg:text-5xl">
            Proof that feels curated, not improvised.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            The demos page now reads like a private proof library. Your next two real demo assets can
            drop straight into the featured slots below without changing the page structure again.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Start strategy intake
            </Link>
            <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
              Tour all divisions
            </Link>
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="grid gap-6">
            {featuredDemoSlots.map((slot) => (
              <article key={slot.id} className="brand-panel overflow-hidden px-6 py-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.34em] text-[var(--copy-muted)]">
                      Featured Demo {slot.id}
                    </p>
                    <h2 className="brand-display mt-3 text-3xl text-white">{slot.title}</h2>
                  </div>
                  <span className="rounded-full border border-[var(--line)] px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">
                    {slot.badge}
                  </span>
                </div>

                <div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="brand-card overflow-hidden p-3">
                    <video
                      src={slot.src}
                      controls
                      preload="metadata"
                      className="h-full min-h-[280px] w-full rounded-[18px] object-cover"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="brand-card p-5">
                      <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">
                        Proof note
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{slot.summary}</p>
                    </div>
                    <div className="brand-card p-5">
                      <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">
                        Why it matters
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                        The gallery now opens with real video proof instead of conceptual placeholders,
                        which makes the parent brand feel substantially more legitimate and complete.
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="space-y-6">
            <section className="brand-panel px-6 py-8">
              <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Proof lanes</p>
              <div className="mt-5 grid gap-4">
                {proofLanes.map((lane) => (
                  <div key={lane} className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                    {lane}
                  </div>
                ))}
              </div>
            </section>

            <section className="brand-panel px-6 py-8">
              <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Division Library</p>
              <div className="mt-5 grid gap-4">
                {ecosystemProjects.map((project) => (
                  <article key={project.slug} className="brand-card p-5">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{project.role}</p>
                    <h2 className="mt-3 text-2xl font-semibold text-white">{project.name}</h2>
                    <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
                      {project.name} can collect reels, screenshots, workflow clips, and case-study proof
                      without breaking the parent gallery’s hierarchy.
                    </p>
                    <Link href={project.href} className="brand-button mt-5 inline-flex px-4 py-3 text-sm transition">
                      Open project overview
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
