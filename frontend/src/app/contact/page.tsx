import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

const engagementLanes = [
  {
    id: "01",
    title: "Strategy Call",
    icon: "🎯",
    copy: "Architecture, positioning, or a fast clarity pass before build work starts.",
  },
  {
    id: "02",
    title: "Build Engagement",
    icon: "🏗️",
    copy: "You know the business problem and want the workflow, UI, and automation stack built cleanly.",
  },
  {
    id: "03",
    title: "Operator Upgrade",
    icon: "⚡",
    copy: "Tools are in place but the surface still feels fragmented, slow, or under-designed.",
  },
] as const;

const intakePrompts = [
  "What process or workflow is leaking the most time right now?",
  "Where do leads, buyers, or requests currently get lost?",
  "What should run automatically that people are still handling manually?",
  "What outcome would make this project feel like a real win in 30–60 days?",
] as const;

export default function ContactPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6 space-y-8">

        {/* ── HERO ─────────────────────────────────────────────────── */}
        <section className="brand-panel relative overflow-hidden px-6 py-12 lg:px-10 lg:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-[radial-gradient(circle,hsl(38_92%_55%/.1),transparent_65%)] blur-3xl" />
            <div className="absolute -bottom-12 left-1/4 h-56 w-56 rounded-full bg-[radial-gradient(circle,hsl(196_100%_70%/.07),transparent_65%)] blur-3xl" />
          </div>
          <div className="relative z-10 grid gap-10 xl:grid-cols-[1fr_1fr] xl:items-center">
            <div>
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <p className="cmd-text">BLACKSPIRE HELIX GROUP / Strategy Intake</p>
              </div>
              <h1 className="brand-accent-text mt-4 text-5xl font-black leading-none tracking-tight lg:text-7xl">
                TELL US<br />
                <span className="text-white">WHAT NEEDS TO</span><br />
                <span className="text-white">RUN BETTER.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-[var(--copy-soft)]">
                Strategy calls, operator dashboards, AI lead routing, workflow automations,
                and branded product surfaces — all built under one flagship command identity.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/recon-engine" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Explore Recon Engine
                </Link>
                <Link href="/services" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Review services
                </Link>
                <Link href="/demos" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Review proof gallery
                </Link>
              </div>
            </div>

            {/* Engagement lanes */}
            <div className="space-y-3">
              {engagementLanes.map((lane, i) => (
                <div key={lane.id} className={`brand-card shine-card p-5 reveal-up stagger-${i + 1}`}>
                  <div className="flex items-start gap-4">
                    <span className="text-2xl shrink-0">{lane.icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{lane.id}</span>
                        <div className="signal-bar flex-1 h-px" />
                      </div>
                      <h3 className="mt-1 text-lg font-bold text-white">{lane.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{lane.copy}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── MAIN CONTENT: FORM + INTAKE ────────────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">

          {/* ── CONTACT FORM ─────────────────────────────────────────── */}
          <section className="brand-panel px-6 py-8 lg:px-8">
            <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Start the conversation</p>
            <h2 className="brand-display mt-3 text-3xl text-white">Send a project brief</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Tell us about your business, your biggest bottleneck, and what you want automated.
              We&apos;ll follow up within 24 hours.
            </p>

            <form
              action="mailto:BHG@blackspirehelix.com"
              method="POST"
              encType="text/plain"
              className="mt-6 space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Full name
                  </label>
                  <input
                    name="name"
                    type="text"
                    placeholder="Carlos Pearson"
                    className="contact-input"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Email address
                  </label>
                  <input
                    name="email"
                    type="email"
                    placeholder="you@company.com"
                    className="contact-input"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Business / company name
                </label>
                <input
                  name="company"
                  type="text"
                  placeholder="Your business name"
                  className="contact-input"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Engagement type
                </label>
                <select name="engagement" className="contact-input brand-input">
                  <option value="">Select engagement mode...</option>
                  <option value="strategy">Strategy Call — Architecture &amp; clarity</option>
                  <option value="build">Build Engagement — Full-stack delivery</option>
                  <option value="upgrade">Operator Upgrade — Elevate what exists</option>
                  <option value="unsure">Not sure yet — let&apos;s talk</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  What needs to run better?
                </label>
                <textarea
                  name="message"
                  rows={5}
                  placeholder="Describe your biggest bottleneck, the workflow that's leaking time, or what you want an AI employee to handle..."
                  className="contact-input"
                  required
                />
              </div>

              <button
                type="submit"
                className="brand-button inline-flex w-full items-center justify-center gap-2 px-6 py-4 text-sm uppercase tracking-[0.22em] transition"
              >
                <span>Send project brief</span>
                <span className="live-dot" />
              </button>
            </form>

            {/* Direct email */}
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-5 text-sm text-[var(--copy-soft)]">
              <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                Prefer email?
              </span>
              <a
                href="mailto:BHG@blackspirehelix.com"
                className="inline-flex items-center gap-2 font-semibold text-[var(--gold-soft)] transition hover:text-[var(--gold)]"
              >
                <span aria-hidden="true">✉️</span>
                BHG@blackspirehelix.com
              </a>
            </div>
          </section>

          {/* ── INTAKE GUIDE ─────────────────────────────────────────── */}
          <div className="space-y-5">
            <section className="brand-panel px-6 py-8">
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Intake guide</p>
              <h2 className="brand-display mt-3 text-2xl text-white">What to bring to the first conversation</h2>
              <div className="mt-5 space-y-3">
                {intakePrompts.map((prompt, index) => (
                  <article key={prompt} className={`brand-card p-4 reveal-up stagger-${index + 1}`}>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--gold)]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p className="text-sm leading-7 text-[var(--copy-soft)]">{prompt}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="brand-panel px-6 py-8">
              <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--gold-soft)]">Best-fit projects</p>
              <div className="mt-4 space-y-3">
                <div className="brand-card p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--copy-muted)] mb-2">We build</p>
                  <p className="text-sm leading-7 text-[var(--copy-soft)]">
                    Lead capture systems, buyer intelligence, service-business intake, operator
                    dashboards, Recon Engine opportunity intelligence, workflow routing, and premium product surfaces built around
                    business leverage.
                  </p>
                </div>
                <div className="brand-card p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--copy-muted)] mb-2">Expected outcome</p>
                  <p className="text-sm leading-7 text-[var(--copy-soft)]">
                    A cleaner system, sharper automation logic, and a more convincing
                    customer-facing experience than generic AI tooling usually produces.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/recon-engine" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  View Recon Engine
                </Link>
                <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Explore ecosystem
                </Link>
                <Link href="/about" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Meet the founder
                </Link>
              </div>
            </section>
          </div>
        </div>

      </div>
    </MarketingShell>
  );
}
