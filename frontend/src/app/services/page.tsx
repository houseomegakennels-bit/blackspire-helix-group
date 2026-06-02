import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { serviceLines, useCases } from "@/lib/ecosystem";

export default function ServicesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6">
        <section className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Services</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold lg:text-5xl">
            AI employees, workflow automations, and digital operating systems.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            BLACKSPIRE HELIX GROUP translates automation into practical business language: more
            leads, faster follow-up, cleaner operations, and better visibility.
          </p>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <article className="brand-panel px-6 py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Core service lines</p>
                <h2 className="brand-display mt-3 text-3xl text-white">The build layers behind the Blackspire offer</h2>
              </div>
              <Link href="/contact" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Start intake
              </Link>
            </div>
            <div className="mt-6 grid gap-4">
              {serviceLines.map((service, index) => (
                <div key={service} className="brand-card p-5">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Layer {String(index + 1).padStart(2, "0")}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{service}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Use-case matrix</p>
            <div className="mt-5 grid gap-4">
              {useCases.map((useCase, index) => (
                <div key={useCase} className="brand-card p-5">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                    Use Case {String(index + 1).padStart(2, "0")}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{useCase}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </MarketingShell>
  );
}
