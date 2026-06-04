import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { DivisionWatermark } from "@/components/division-watermark";
import { brandAssets } from "@/lib/brand-assets";

const navItems = [
  { href: "/workspace/deal-engine", label: "Command Deck" },
  { href: "/seller-engine", label: "Seller Engine" },
  { href: "/workspace/buyer-engine", label: "Buyer Engine" },
  { href: "/ecosystem/deal-engine", label: "Public Division Page" },
  { href: "/ecosystem", label: "Ecosystem" },
  { href: "/", label: "Blackspire Helix" },
];

/**
 * Deal Engine surface uses the shared `theme-deal-engine` class (defined in
 * globals.css) as the single source of truth for its logo palette: teal/cyan
 * primary ("D" + "DEAL ENGINE" wordmark), silver/platinum structure, and gold
 * accents (helix sword, gear, "CLOSE"). The class remaps the --gold/--line and
 * --project-* token families so every brand-* component inherits the right
 * color instead of the amber root default.
 */
export function DealEngineShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="theme-deal-engine relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,hsl(193_100%_60%/.12),transparent_28%),radial-gradient(circle_at_80%_16%,hsl(44_73%_62%/.10),transparent_24%),linear-gradient(180deg,hsl(224_24%_4%)_0%,hsl(213_20%_4%)_24%,hsl(218_20%_6%)_100%)] text-foreground"
    >
      <DivisionWatermark logoSrc={brandAssets.dealEngine.logo} />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1800px] gap-5 px-3 py-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-5">
        <aside className="brand-panel sticky top-3 h-fit overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-36 rounded-b-[42px] bg-[radial-gradient(circle_at_top,hsl(193_100%_60%/.14),transparent_74%)]" />
          <div className="relative border-b border-[var(--line)] pb-5">
            <div className="mb-4 overflow-hidden rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(0_0%_2%/.96))] px-3 py-4">
              <div className="relative mx-auto h-[172px] w-full max-w-[218px]">
                <Image
                  src={brandAssets.dealEngine.logo}
                  alt={brandAssets.dealEngine.name}
                  fill
                  priority
                  className="object-contain"
                  sizes="218px"
                />
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-[0.48em] text-[var(--gold-soft)]">Blackspire Helix Group</p>
            <h1 className="brand-display mt-3 text-3xl text-white">{brandAssets.dealEngine.name}</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              Acquisition, underwriting, contracts, buyer handoff, and disposition packaging between Seller Engine and Buyer Engine.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-cyan-300">
              <span className="live-dot" /> Wholesale command surface online
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
              Deal Engine starts after seller qualification and ends with a buyer-ready packet, contract posture, and disposition path.
            </p>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">{children}</section>
      </div>
    </main>
  );
}
