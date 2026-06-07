import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { DivisionWatermark } from "@/components/division-watermark";
import { RealEstateWorkflowRail } from "@/components/real-estate-workflow-rail";
import { brandAssets } from "@/lib/brand-assets";

const navItems = [
  { href: "/workspace/nexus", label: "Dashboard" },
  { href: "/workspaces/nexus/leads", label: "Leads" },
  { href: "/workspaces/nexus/contacts", label: "Contacts" },
  { href: "/workspaces/nexus/settings", label: "Settings" },
  { href: "/workspaces/nexus/logs", label: "Logs" },
  { href: "/seller-engine", label: "Seller Engine" },
  { href: "/workspace/deal-engine", label: "Deal Engine" },
];

const themeStyle = {
  "--gold": "#8B5CF6",
  "--gold-soft": "rgba(229, 229, 234, 0.82)",
  "--gold-strong": "#A855F7",
  "--line": "rgba(198, 205, 214, 0.22)",
  "--line-strong": "rgba(180, 160, 240, 0.46)",
  "--project-accent": "#8B5CF6",
  "--project-glow": "rgba(139, 92, 246, 0.34)",
  "--project-surface": "rgba(139, 92, 246, 0.12)",
  "--project-edge": "rgba(198, 205, 214, 0.38)",
} as CSSProperties;

export function NexusShell({ children }: { children: ReactNode }) {
  return (
    <main
      style={themeStyle}
      className="theme-nexus relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_16%_-2%,hsl(265_88%_64%/.24),transparent_42%),radial-gradient(circle_at_86%_10%,hsl(0_0%_88%/.10),transparent_34%),radial-gradient(circle_at_50%_118%,hsl(262_46%_32%/.18),transparent_52%),linear-gradient(180deg,hsl(255_26%_6%)_0%,hsl(258_26%_4%)_46%,hsl(262_30%_5%)_100%)] text-foreground"
    >
      <DivisionWatermark logoSrc={brandAssets.nexus.logo} />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1800px] gap-5 px-3 py-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-5">
        <aside className="brand-panel sticky top-3 h-fit overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-36 rounded-b-[42px] bg-[radial-gradient(circle_at_top,hsl(265_88%_64%/.16),transparent_74%)]" />
          <div className="relative border-b border-[var(--line)] pb-5">
            <div className="mb-4 overflow-hidden rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(0_0%_2%/.96))] px-3 py-4">
              <div className="relative mx-auto h-[172px] w-full max-w-[218px]">
                <Image
                  src={brandAssets.nexus.logo}
                  alt={brandAssets.nexus.name}
                  fill
                  priority
                  className="object-contain"
                  sizes="218px"
                />
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-[0.48em] text-[var(--gold-soft)]">Blackspire Helix Group</p>
            <h1 className="brand-display mt-3 text-3xl text-white">Blackspire Nexus</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              Connecting properties to people through skip trace, contact intelligence, confidence scoring, and clean handoff into Deal Engine.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-violet-200">
              <span className="live-dot" /> Contact intelligence surface online
            </div>
          </div>

          <nav className="mt-5 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-[16px] border border-[var(--line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(256_22%_9%/.92))] px-4 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] transition hover:-translate-y-[1px] hover:border-[var(--line-strong)] hover:text-white hover:shadow-[0_16px_30px_hsl(0_0%_0%/.28)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <RealEstateWorkflowRail active="nexus" compact />
        </aside>
        <section className="min-w-0 space-y-5">{children}</section>
      </div>
    </main>
  );
}
