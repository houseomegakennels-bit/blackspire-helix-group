import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

const intakePrompts = [
  "What process or workflow is leaking the most time right now?",
  "Where do leads, buyers, or requests currently get lost?",
  "What should the system do automatically that people are still handling manually?",
  "What outcome would make this project feel like a real win in 30-60 days?",
] as const;

const engagementLanes = [
  {
    title: "Strategy Call",
    copy: "Best when you need architecture, positioning, or a fast clarity pass before build work starts.",
  },
  {
    title: "Build Engagement",
    copy: "Best when you already know the business problem and want the workflow, UI, and automation stack built cleanly.",
  },
  {
    title: "Operator Upgrade",
    copy: "Best when you already have tools in place but the surface still feels fragmented, slow, or under-designed.",
  },
] as const;

export default function ContactPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6">
        <section className="grid gap-8 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="brand-panel overflow-hidden px-6 py-8">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-[38%] bg-[radial-gradient(circle_at_center,hsl(196_100%_70%/.08),transparent_72%)]" />
            <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Contact</p>
            <h1 className="brand-accent-text mt-3 text-4xl font-semibold lg:text-5xl">
              Tell us what needs to run better.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              This page now reads like a real intake destination instead of a fake form. Use it to
              frame the project, choose the right engagement mode, and move visitors toward a
              strategy conversation with confidence.
            </p>

            <div className="mt-8 space-y-4">
              {engagementLanes.map((lane) => (
                <div key={lane.title} className="brand-card p-5">
                  <div className="text-lg font-semibold text-white">{lane.title}</div>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{lane.copy}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/services" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review services
              </Link>
              <Link href="/demos" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review proof gallery
              </Link>
            </div>
          </div>

          <section className="brand-panel px-6 py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Intake Outline</p>
                <h2 className="brand-display mt-3 text-3xl text-white">What to bring into the first conversation</h2>
              </div>
              <span className="rounded-full border border-[var(--line)] px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">
                Concierge-style intake
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              {intakePrompts.map((prompt, index) => (
                <article key={prompt} className="brand-card p-5">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Prompt {String(index + 1).padStart(2, "0")}
                  </div>
                  <p className="mt-3 text-base leading-7 text-white">{prompt}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Best-fit projects
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                  Lead capture systems, buyer intelligence, service-business intake, operator dashboards,
                  workflow routing, and premium product surfaces built around business leverage.
                </p>
              </div>
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Expected outcome
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                  A cleaner system, sharper automation logic, and a more convincing customer-facing
                  experience than generic AI tooling usually produces.
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/ecosystem" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Explore ecosystem
              </Link>
              <Link href="/about" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Read founder thesis
              </Link>
            </div>
          </section>
        </section>
      </div>
    </MarketingShell>
  );
}
