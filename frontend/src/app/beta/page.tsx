import Link from "next/link";

import { requireSignedInPage } from "@/lib/operator-access";
import { BetaFeedback } from "@/components/beta-feedback";

export const dynamic = "force-dynamic";

const PIPELINE = ["Harvester", "Seller Engine", "Nexus", "Deal Engine", "Buyer Engine"];

const PRIMARY_ACTIONS: Array<{ title: string; detail: string; href: string; cta: string; accent?: boolean }> = [
  { title: "Run a Seller Sweep", detail: "Pull motivated-seller leads from live county/public-record sources, score them, and load them into Seller Engine.", href: "/seller-engine/new", cta: "Launch Seller Sweep", accent: true },
  { title: "Run a Buyer Sweep", detail: "Discover active cash buyers in a county and build a buyer report.", href: "/searches/new", cta: "Launch Buyer Sweep" },
  { title: "Review the Pipeline", detail: "Sentinel shows what needs attention, deal readiness, and the opportunity feed.", href: "/workspace/sentinel", cta: "Open Sentinel" },
  { title: "Try the Sample Pipeline", detail: "Walk a demo property through every stage — great for your first look.", href: "/beta/demo", cta: "Open Demo" },
];

const CHECKLIST = [
  "Run your first Seller Sweep",
  "Review a scored seller lead",
  "Inspect a Nexus contact",
  "Open a deal in Deal Engine",
  "Run a Buyer Sweep / view a buyer report",
  "Send feedback on anything confusing",
];

export default async function BetaDashboardPage() {
  const { role } = await requireSignedInPage();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.1),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 lg:px-6 lg:py-10 space-y-6">
        {/* Header */}
        <div className="brand-panel p-6 lg:p-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-[#2dd4bf55] bg-[rgba(45,212,191,0.12)] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#5eead4]">
              {role === "admin" ? "Operator" : "Beta Tester"}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--copy-muted)]">Blackspire Helix · Real Estate Pipeline</span>
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-[0.04em] text-white sm:text-4xl">Welcome — start here</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">
            This is your beta cockpit. Run the real pipeline, explore each engine, and tell us what's confusing.
            You don't need any API keys or setup — just use the site.
          </p>
          {/* Pipeline map */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {PIPELINE.map((stage, i) => (
              <span key={stage} className="flex items-center gap-2">
                <span className="rounded-full border border-[var(--line)] bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--copy-soft)]">{stage}</span>
                {i < PIPELINE.length - 1 ? <span className="text-[#5eead4]">→</span> : null}
              </span>
            ))}
          </div>
        </div>

        {/* Primary actions */}
        <div className="grid gap-4 md:grid-cols-2">
          {PRIMARY_ACTIONS.map((action) => (
            <div key={action.href} className="brand-panel flex flex-col justify-between p-5" style={action.accent ? { borderColor: "#2dd4bf55" } : undefined}>
              <div>
                <div className="text-base font-semibold text-white">{action.title}</div>
                <p className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{action.detail}</p>
              </div>
              <Link
                href={action.href}
                className="mt-4 inline-flex w-fit rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition"
                style={
                  action.accent
                    ? { color: "#020403", background: "#2dd4bf" }
                    : { color: "#5eead4", border: "1px solid #2dd4bf55", background: "rgba(45,212,191,0.08)" }
                }
              >
                {action.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          {/* Checklist */}
          <div className="brand-panel p-6">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">What to test next</div>
            <ul className="mt-4 space-y-2">
              {CHECKLIST.map((item, i) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-6 text-[var(--copy-soft)]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[10px] text-[#5eead4]">{i + 1}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/seller-engine" className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--copy-soft)] hover:text-white">Seller Engine</Link>
              <Link href="/buyers" className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--copy-soft)] hover:text-white">Buyer Reports</Link>
              <Link href="/workspace/property" className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--copy-soft)] hover:text-white">Properties</Link>
            </div>
          </div>

          {/* Disclaimer / feedback */}
          <div className="brand-panel p-6">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Beta notice</div>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              This is a beta. Outputs are for testing and may be reviewed by Blackspire to improve the product.
              Any real-estate or legal documents still require human review — don't rely on generated drafts as advice.
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              Hit the <span className="text-[var(--gold-soft)]">Feedback</span> button (bottom-left) any time something is
              confusing, broken, or missing.
            </p>
          </div>
        </div>
      </div>
      <BetaFeedback />
    </main>
  );
}
