import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { industries } from "@/lib/ecosystem";

const framingNotes = [
  "AI employees only matter when they match the rhythm of a real industry.",
  "Every market needs different intake logic, operational language, and urgency rules.",
  "The parent brand should prove range without collapsing into generic AI-agency messaging.",
] as const;

export default function IndustriesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6">
        <section className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Industries</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold lg:text-5xl">
            The same automation thesis, translated market by market.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            The Blackspire ecosystem should prove that AI employees are not a single generic
            product. They become useful when they are shaped around how a specific industry
            actually sells, routes work, and closes revenue.
          </p>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <article className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Framing notes</p>
            <div className="mt-5 grid gap-4">
              {framingNotes.map((note, index) => (
                <div key={note} className="brand-card p-5">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Thesis {String(index + 1).padStart(2, "0")}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{note}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="brand-panel px-6 py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Industry map</p>
                <h2 className="brand-display mt-3 text-3xl text-white">Where the operating model lands best</h2>
              </div>
              <Link href="/services" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review services
              </Link>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {industries.map((industry) => (
                <article key={industry.name} className="brand-card p-5">
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--copy-muted)]">Industry</p>
                  <h3 className="mt-3 text-2xl font-semibold text-white">{industry.name}</h3>
                  <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">{industry.summary}</p>
                </article>
              ))}
            </div>
          </article>
        </section>
      </div>
    </MarketingShell>
  );
}
