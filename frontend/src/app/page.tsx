import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { HelixCommandAtlas } from "@/components/helix-command-atlas";
import { LuxuryHeroStage } from "@/components/luxury-hero-stage";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects, parentBrand, serviceLines } from "@/lib/ecosystem";
import { realEstatePipeline, workspaceEntries } from "@/lib/site-structure";

export const metadata: Metadata = {
  title: "BLACKSPIRE HELIX GROUP | Systems for serious operators",
  description:
    "BLACKSPIRE HELIX GROUP builds intelligent operating systems for strategy, real estate, automation, and specialized business divisions.",
};

const signalMetrics = [
  { value: "09", label: "Operating systems" },
  { value: "04", label: "Core pipeline stages" },
  { value: "24.7", label: "ms signal sync" },
] as const;

const featuredWorkspaces = workspaceEntries.slice(0, 4);

export default function Home() {
  return (
    <MarketingShell>
      <div className="home-canvas">
        <section className="home-hero" aria-labelledby="hero-title">
          <div className="home-hero-copy">
            <div className="hero-eyebrow"><span /> BLACKSPIRE HELIX GROUP / 2026</div>
            <h1 id="hero-title" className="home-hero-title">
              Intelligence with a <em>point of view.</em>
            </h1>
            <p className="home-hero-lede">
              {parentBrand.description} We build the command surfaces, automations, and specialized
              systems that turn complicated operating work into a clear next move.
            </p>
            <div className="home-hero-actions">
              <Link href="/workspaces" className="signal-button signal-button-primary">
                <span>Enter the systems</span><span aria-hidden="true">↗</span>
              </Link>
              <Link href="/contact" className="signal-text-link">Start a conversation <span aria-hidden="true">→</span></Link>
            </div>
            <div className="signal-metrics" aria-label="Blackspire system metrics">
              {signalMetrics.map((metric) => (
                <div key={metric.label} className="signal-metric">
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>
          </div>
          <LuxuryHeroStage />
          <div className="hero-scroll-cue" aria-hidden="true"><span /> Scroll to map the system</div>
        </section>

        <HelixCommandAtlas projects={ecosystemProjects} />

        <section className="pipeline-section" aria-labelledby="pipeline-title">
          <div className="section-heading-row">
            <div>
              <div className="section-kicker">The acquisition chain</div>
              <h2 id="pipeline-title">From signal to <em>closure.</em></h2>
            </div>
            <p>Every stage has a job. Every handoff leaves a trace.</p>
          </div>
          <div className="pipeline-rail">
            {realEstatePipeline.map((stage, index) => (
              <Link
                key={stage}
                href={stage === "Harvester" ? "/workspace/harvester" : stage === "Seller Engine" ? "/workspace/seller-engine" : stage === "Nexus" ? "/workspace/nexus" : stage === "Deal Engine" ? "/workspace/deal-engine" : "/workspace/buyer-engine"}
                className="pipeline-step"
              >
                <span className="pipeline-step-number">0{index + 1}</span>
                <span className="pipeline-step-line" aria-hidden="true" />
                <strong>{stage}</strong>
                <small>{index === 0 ? "Capture" : index === 1 ? "Qualify" : index === 2 ? "Resolve" : index === 3 ? "Underwrite" : "Match"}</small>
                <span className="pipeline-step-arrow" aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="workspace-section" aria-labelledby="workspace-title">
          <div className="section-heading-row workspace-heading">
            <div>
              <div className="section-kicker">Live command surfaces</div>
              <h2 id="workspace-title">The work is <em>already moving.</em></h2>
            </div>
            <Link href="/workspaces" className="signal-text-link">View all workspaces <span aria-hidden="true">→</span></Link>
          </div>
          <div className="workspace-grid">
            {featuredWorkspaces.map((entry, index) => (
              <Link key={entry.href} href={entry.href} className={`workspace-feature workspace-feature-${index + 1}`}>
                <div className="workspace-feature-top"><span>0{index + 1}</span><span>{entry.status}</span></div>
                <div>
                  <small>{entry.division}</small>
                  <h3>{entry.title}</h3>
                  <p>{entry.description}</p>
                </div>
                <span className="workspace-feature-arrow" aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="division-section" aria-labelledby="division-title">
          <div className="division-copy">
            <div className="section-kicker">Built for the edge of the market</div>
            <h2 id="division-title">A parent brand with <em>specialized reach.</em></h2>
            <p>
              Strategy, real estate intelligence, service automation, creative operations, and
              opportunity research live in one coherent system without collapsing into one generic product.
            </p>
            <Link href="/ecosystem" className="signal-button signal-button-quiet">Explore the ecosystem <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="division-orbit" aria-hidden="true">
            <div className="division-orbit-core">BH</div>
            {ecosystemProjects.slice(0, 6).map((project, index) => (
              <span key={project.slug} className={`division-orbit-node division-orbit-node-${index + 1}`} style={{ "--orbit-accent": project.accent } as CSSProperties}>{project.monogram}</span>
            ))}
          </div>
        </section>

        <section className="services-section" aria-labelledby="services-title">
          <div className="section-heading-row">
            <div><div className="section-kicker">Build lanes</div><h2 id="services-title">What we make <em>useful.</em></h2></div>
            <p>Quiet infrastructure for teams that need more leverage, not more software noise.</p>
          </div>
          <div className="services-list">
            {serviceLines.map((service, index) => (
              <div key={service} className="service-line"><span>0{index + 1}</span><p>{service}</p><span aria-hidden="true">↗</span></div>
            ))}
          </div>
        </section>

        <section className="home-cta" aria-labelledby="cta-title">
          <div className="home-cta-grid" aria-hidden="true" />
          <div className="section-kicker">A clearer operating picture starts here</div>
          <h2 id="cta-title">Build the system<br /><em>behind the signal.</em></h2>
          <Link href="/contact" className="signal-button signal-button-primary">Request a project brief <span aria-hidden="true">↗</span></Link>
        </section>
      </div>
    </MarketingShell>
  );
}
