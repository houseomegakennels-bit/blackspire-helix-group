import Link from "next/link";

import { Metric, Panel, StatusPill } from "@/components/buyer-shell";
import { SkipTraceEngineShell } from "@/components/skip-trace-engine-shell";
import type { SkipTraceWorkspaceSnapshot } from "@/lib/skip-trace-engine";

function tone(status: string) {
  if (/queued|needed/i.test(status)) return "warn";
  if (/verify|active/i.test(status)) return "active";
  return "good";
}

export function SkipTraceEngineHome({ snapshot }: { snapshot: SkipTraceWorkspaceSnapshot }) {
  return (
    <SkipTraceEngineShell>
      <header className="brand-panel overflow-hidden px-6 py-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[38%] bg-[radial-gradient(circle_at_center,hsl(188_82%_63%/.10),transparent_72%)]" />
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Contact Resolution Command</p>
              <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                The Helix workspace where missing seller contact data gets resolved.
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                Blackspire Skip Trace Engine sits between Seller Engine and Deal Engine whenever owner outreach data is incomplete. It exists to recover, verify, and clear the outreach path before acquisitions starts working the lead.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/seller-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Open seller pipeline
              </Link>
              <Link href="/workspace/deal-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Open deal engine
              </Link>
              <Link href="/ecosystem/skip-trace-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.2em] transition">
                Public division page
              </Link>
            </div>
          </div>

          <div className="grid gap-4 content-start">
            <div className="brand-card p-5">
              <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--gold-soft)]">Workflow</div>
              <div className="mt-3 space-y-3">
                {snapshot.workflow.map((step) => (
                  <div key={step.title} className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-4">
                    <div className="text-base font-semibold text-white">{step.title}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{step.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        {snapshot.metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />
        ))}
      </section>

      <Panel
        eyebrow="Active Queue"
        title="Records needing skip trace or verification"
        description="These seller and deal records still need contact resolution before acquisitions should treat them as outreach-ready."
      >
        <div className="space-y-4">
          {snapshot.queue.map((item) => (
            <div key={`${item.source}-${item.id}`} className="brand-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{item.source}</div>
                  <div className="mt-2 text-xl font-semibold text-white">{item.propertyAddress}</div>
                  <div className="mt-1 text-sm text-[var(--copy-soft)]">{item.ownerName} / {item.county} County</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={tone(item.skipTraceStatus)} label={item.skipTraceStatus.toLowerCase()} />
                  <StatusPill tone={item.phone === "Not captured" ? "warn" : "good"} label={item.phoneStatus.toLowerCase()} />
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Phone</div>
                  <div className="mt-2 text-lg font-semibold text-white">{item.phone}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Phone source</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{item.phoneSource}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Next action</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{item.nextAction}</div>
                </div>
              </div>
              <div className="mt-4">
                <Link href={item.href} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition">
                  Open source workspace
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </SkipTraceEngineShell>
  );
}
