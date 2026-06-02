import { MarketingShell } from "@/components/marketing-shell";
import { serviceLines, useCases } from "@/lib/ecosystem";

export default function ServicesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section className="brand-panel px-6 py-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">Services</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold">
            AI employees, workflow automations, and digital operating systems.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            BLACKSPIRE HELIX GROUP translates automation into practical business language: more leads, faster follow-up, cleaner operations, and better visibility.
          </p>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Core service lines</p>
            <div className="mt-5 grid gap-4">
              {serviceLines.map((service) => (
                <div key={service} className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                  {service}
                </div>
              ))}
            </div>
          </div>

          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Use cases</p>
            <div className="mt-5 grid gap-4">
              {useCases.map((useCase) => (
                <div key={useCase} className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                  {useCase}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
