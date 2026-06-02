import { MarketingShell } from "@/components/marketing-shell";

export default function AboutPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1400px] px-4 py-16 lg:px-6">
        <section className="brand-panel px-6 py-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">About</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold">
            Building a portfolio of niche AI-powered business systems.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            BLACKSPIRE HELIX GROUP is positioned as a premium AI automation and digital infrastructure company. The goal is not to sell a generic chatbot. The goal is to build industry-specific operating systems that make real work move faster.
          </p>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Founder vision</p>
            <p className="mt-5 text-sm leading-7 text-[var(--copy-soft)]">
              The ecosystem concept in the project PDF is the right strategic frame: one parent company, multiple proof-point divisions, and a consistent promise to replace repetitive work with intelligent automation. The website should feel like a command center for that long-term portfolio.
            </p>
            <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              In practice, that means every division demonstrates a different expression of the same core idea: AI employees that can capture demand, route information, reduce delay, and create cleaner operations.
            </p>
          </div>

          <div className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Brand philosophy</p>
            <div className="mt-5 grid gap-4">
              <div className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                Premium, not generic.
              </div>
              <div className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                Operational, not theoretical.
              </div>
              <div className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                One ecosystem, many industry-specific surfaces.
              </div>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
