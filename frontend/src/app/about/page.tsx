import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

const brandPrinciples = [
  "Premium, not generic.",
  "Operational, not theoretical.",
  "One ecosystem, many industry-specific surfaces.",
] as const;

export default function AboutPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-16 lg:px-6">
        <section className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
          <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">About</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-semibold lg:text-5xl">
            Building a portfolio of niche AI-powered business systems.
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            BLACKSPIRE HELIX GROUP is positioned as a premium AI automation and digital
            infrastructure company. The goal is not to sell a generic chatbot. The goal is to build
            industry-specific operating systems that make real work move faster.
          </p>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
          <article className="brand-panel px-6 py-8">
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Founder vision</p>
            <div className="mt-5 grid gap-4">
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                The ecosystem concept in the project PDF is still the right frame: one parent company,
                multiple proof-point divisions, and a consistent promise to replace repetitive work
                with intelligent automation.
              </div>
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                In practice, that means every division demonstrates a different expression of the
                same core idea: AI employees that can capture demand, route information, reduce
                delay, and create cleaner operations.
              </div>
              <div className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                The site should feel like a command-grade holding company with enough polish that
                each product reads as serious, valuable, and intentionally built.
              </div>
            </div>
          </article>

          <article className="brand-panel px-6 py-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">Brand philosophy</p>
                <h2 className="brand-display mt-3 text-3xl text-white">How the parent brand should behave</h2>
              </div>
            </div>
            <div className="mt-6 grid gap-4">
              {brandPrinciples.map((principle) => (
                <div key={principle} className="brand-card p-5 text-sm leading-7 text-[var(--copy-soft)]">
                  {principle}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/ecosystem" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review ecosystem
              </Link>
              <Link href="/demos" className="brand-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition">
                Review proof gallery
              </Link>
            </div>
          </article>
        </section>
      </div>
    </MarketingShell>
  );
}
