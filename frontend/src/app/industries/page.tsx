import { MarketingShell } from "@/components/marketing-shell";
import { industries } from "@/lib/ecosystem";

export default function IndustriesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section className="brand-panel px-6 py-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Industries</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold">
            The same automation philosophy, translated market by market.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            The Blackspire ecosystem is built to prove that AI employees are not a single generic product. They become useful when they are shaped around how a specific industry actually works.
          </p>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {industries.map((industry) => (
            <article key={industry.name} className="brand-panel px-6 py-6">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--copy-muted)]">Industry</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{industry.name}</h2>
              <p className="mt-4 text-sm leading-6 text-[var(--copy-soft)]">{industry.summary}</p>
            </article>
          ))}
        </section>
      </div>
    </MarketingShell>
  );
}
