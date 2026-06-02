import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

const intakeFields = [
  "Name",
  "Email",
  "Phone",
  "Business type",
  "Biggest manual task",
  "Monthly lead volume",
  "Budget range",
  "Urgency",
] as const;

export default function ContactPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section className="grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Contact</p>
            <h1 className="brand-accent-text mt-3 text-4xl font-semibold">
              Tell us what you want automated.
            </h1>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              This page is now structured as the intake destination for strategy calls and AI-readiness conversations. The next pass will wire these fields to n8n and persistence.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/services" className="brand-button inline-flex px-4 py-3 text-sm transition">
                Review services
              </Link>
              <Link href="/ecosystem" className="brand-button inline-flex px-4 py-3 text-sm transition">
                Explore ecosystem
              </Link>
            </div>
          </div>

          <section className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">AI Readiness Intake</p>
            <form className="mt-5 grid gap-4 md:grid-cols-2">
              {intakeFields.map((field) => (
                <label key={field} className="grid gap-2 text-sm text-[var(--copy-soft)]">
                  <span>{field}</span>
                  <input
                    type="text"
                    placeholder={field}
                    className="brand-input rounded-[14px] px-4 py-3"
                    readOnly
                  />
                </label>
              ))}
              <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2">
                <span>What outcome do you want the system to create?</span>
                <textarea
                  placeholder="Lead conversion, faster follow-up, cleaner operations, reporting, or another business result."
                  className="brand-input min-h-[140px] rounded-[14px] px-4 py-3"
                  readOnly
                />
              </label>
              <div className="md:col-span-2">
                <button type="button" className="brand-button inline-flex px-4 py-3 text-sm opacity-80">
                  Intake wiring comes next
                </button>
              </div>
            </form>
          </section>
        </section>
      </div>
    </MarketingShell>
  );
}
