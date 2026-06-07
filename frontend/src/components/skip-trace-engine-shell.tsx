import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

const navItems = [
  { href: "/workspace/skip-trace-engine", label: "Command Deck" },
  { href: "/seller-engine", label: "Seller Engine" },
  { href: "/workspace/deal-engine", label: "Deal Engine" },
  { href: "/workspace/buyer-engine", label: "Buyer Engine" },
  { href: "/ecosystem/skip-trace-engine", label: "Public Division Page" },
  { href: "/ecosystem", label: "Ecosystem" },
];

const themeStyle = {
  "--gold": "#59D7E8",
  "--gold-soft": "rgba(89, 215, 232, 0.72)",
  "--gold-strong": "#9BEAFA",
  "--line": "rgba(143, 193, 202, 0.20)",
  "--line-strong": "rgba(143, 193, 202, 0.42)",
  "--project-accent": "#59D7E8",
  "--project-glow": "rgba(89, 215, 232, 0.34)",
  "--project-surface": "rgba(89, 215, 232, 0.12)",
  "--project-edge": "rgba(183, 212, 220, 0.38)",
} as CSSProperties;

export function SkipTraceEngineShell({ children }: { children: ReactNode }) {
  return (
    <main
      style={themeStyle}
      className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_14%_-2%,hsl(188_82%_63%/.20),transparent_42%),radial-gradient(circle_at_86%_10%,hsl(200_48%_68%/.14),transparent_36%),radial-gradient(circle_at_50%_118%,hsl(194_44%_34%/.16),transparent_52%),linear-gradient(180deg,hsl(205_28%_6%)_0%,hsl(210_26%_4%)_46%,hsl(212_28%_5%)_100%)] text-foreground"
    >
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1800px] gap-5 px-3 py-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-5">
        <aside className="brand-panel sticky top-3 h-fit overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-36 rounded-b-[42px] bg-[radial-gradient(circle_at_top,hsl(188_82%_63%/.16),transparent_74%)]" />
          <div className="relative border-b border-[var(--line)] pb-5">
            <div className="mb-4 flex h-[172px] items-center justify-center overflow-hidden rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(0_0%_2%/.96))]">
              <div className="flex h-[116px] w-[116px] items-center justify-center rounded-full border border-[var(--line-strong)] bg-[radial-gradient(circle_at_50%_30%,hsl(188_82%_63%/.20),transparent_70%)] text-[30px] font-semibold tracking-[0.28em] text-white">
                STE
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-[0.48em] text-[var(--gold-soft)]">Blackspire Helix Group</p>
            <h1 className="brand-display mt-3 text-3xl text-white">Blackspire Skip Trace Engine</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              Contact-resolution command for seller phone recovery, number verification, and clean handoff back into acquisitions.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-cyan-200">
              <span className="live-dot" /> Contact resolution surface online
            </div>
          </div>

          <nav className="mt-5 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-[16px] border border-[var(--line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(214_20%_9%/.92))] px-4 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] transition hover:-translate-y-[1px] hover:border-[var(--line-strong)] hover:text-white hover:shadow-[0_16px_30px_hsl(0_0%_0%/.28)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="brand-card mt-6 p-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">Mission Boundary</div>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Skip Trace Engine starts when seller contact posture is incomplete and ends when the best outreach number is verified and handed back into the pipeline.
            </p>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">{children}</section>
      </div>
    </main>
  );
}
