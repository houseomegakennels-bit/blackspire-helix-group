import Link from "next/link";

import { BetaFeedback } from "@/components/beta-feedback";
import { requireSignedInPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

const STAGES = [
  {
    engine: "Harvester",
    title: "Opportunity captured & extracted",
    body: "A Facebook post screenshot was OCR'd into a structured opportunity.",
    facts: [
      ["Address", "1846 Cascade St, Fayetteville, NC"],
      ["Asking", "$108,999"],
      ["Beds / Baths", "3 / 1.5"],
      ["Condition", "Needs roof; HVAC newer"],
    ],
  },
  {
    engine: "Seller Engine",
    title: "Seller scored & imported",
    body: "Motivation scored from distress + equity signals.",
    facts: [
      ["Seller", "Eric Fair"],
      ["Motivation", "78 / 100"],
      ["Equity", "~$71k"],
      ["Status", "Contact Ready"],
    ],
  },
  {
    engine: "Nexus",
    title: "Contact resolved",
    body: "Skip trace returned a verified phone with confidence scoring.",
    facts: [
      ["Phone", "(910) 555-0142"],
      ["Confidence", "82 / 100"],
      ["DNC", "Clear"],
      ["Provider", "Tracerfy"],
    ],
  },
  {
    engine: "Deal Engine",
    title: "Deal underwritten",
    body: "ARV, MAO, and assignment spread computed; readiness tracked.",
    facts: [
      ["ARV", "$205,000"],
      ["MAO", "$118,500"],
      ["Assignment fee", "$15,000"],
      ["Readiness", "On Track (74)"],
    ],
  },
  {
    engine: "Buyer Engine",
    title: "Real buyers matched",
    body: "Matched against the live buyer universe for the county.",
    facts: [
      ["Buyers in county", "1,206"],
      ["Top match", "UP EIP LLC (cash)"],
      ["Demand", "High"],
      ["Action", "Send + request POF"],
    ],
  },
];

export default async function BetaDemoPage() {
  await requireSignedInPage();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.1),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[900px] space-y-6 px-4 py-8 lg:px-6 lg:py-10">
        <div className="flex items-center gap-3 text-xs">
          <Link href="/beta" className="text-[#5eead4] hover:underline">
            &larr; Beta home
          </Link>
        </div>

        <div className="brand-panel p-6 lg:p-7">
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
            Sample / demo data
          </span>
          <h1 className="mt-3 text-3xl font-black tracking-[0.04em] text-white">How the pipeline works</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">
            Follow one property through every engine. This is illustrative sample data - nothing here is saved. When
            you&apos;re ready, run a real{" "}
            <Link href="/seller-engine/new" className="text-[#5eead4] hover:underline">
              Seller Sweep
            </Link>
            .
          </p>
        </div>

        <div className="space-y-4">
          {STAGES.map((stage, i) => (
            <div key={stage.engine} className="brand-panel p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#2dd4bf] text-xs font-black text-[#5eead4]">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#5eead4]">{stage.engine}</div>
                  <div className="text-base font-semibold text-white">{stage.title}</div>
                </div>
              </div>
              <p className="mt-2 text-sm text-[var(--copy-soft)]">{stage.body}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {stage.facts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 rounded-[10px] border border-[var(--line)] bg-black/20 px-3 py-2 text-xs">
                    <span className="text-[var(--copy-muted)]">{k}</span>
                    <span className="text-right text-white">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="brand-panel p-6 text-center">
          <div className="text-sm text-[var(--copy-soft)]">That&apos;s the full Harvester -&gt; Seller -&gt; Nexus -&gt; Deal -&gt; Buyer flow.</div>
          <Link href="/seller-engine/new" className="mt-3 inline-flex rounded-full bg-[#34d399] px-6 py-3 text-xs uppercase tracking-[0.18em] text-[#020403]">
            Run a real Seller Sweep -&gt;
          </Link>
        </div>
      </div>
      <BetaFeedback />
    </main>
  );
}
