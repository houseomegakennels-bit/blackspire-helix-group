import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { DivisionWatermark } from "@/components/division-watermark";
import { brandAssets } from "@/lib/brand-assets";

const navItems = [
  { href: "/seller-engine", label: "Command Deck" },
  { href: "/seller-engine#leads", label: "Seller Leads" },
  { href: "/seller-engine#harvester", label: "Data Harvester" },
  { href: "/seller-engine#alerts", label: "Alerts" },
  { href: "/seller-engine#settings", label: "Scoring Settings" },
  { href: "/workspace/deal-engine", label: "Deal Engine" },
  { href: "/workspace/buyer-engine", label: "Buyer Engine" },
  { href: "/", label: "Blackspire Helix" },
];

export function SellerEngineShell({ children }: { children: ReactNode }) {
  return (
    <main className="seller-shell relative min-h-screen overflow-hidden text-foreground">
      <DivisionWatermark logoSrc={brandAssets.sellerEngine.logo} />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1800px] gap-5 px-3 py-3 lg:grid-cols-[270px_minmax(0,1fr)] lg:px-5">
        <aside className="seller-panel sticky top-3 h-fit overflow-hidden p-5">
          <div className="seller-radar" />
          <div className="relative border-b border-[var(--seller-line)] pb-5">
            <div className="mb-4 overflow-hidden rounded-[24px] border border-[var(--seller-line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(0_0%_2%/.96))] px-3 py-4">
              <div className="relative mx-auto h-[148px] w-full max-w-[208px]">
                <Image
                  src={brandAssets.sellerEngine.logo}
                  alt={brandAssets.sellerEngine.name}
                  fill
                  priority
                  className="object-contain"
                  sizes="208px"
                />
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-[0.48em] text-[var(--seller-silver)]">Blackspire Helix Group</p>
            <h1 className="brand-display mt-3 text-3xl text-white">{brandAssets.sellerEngine.name}</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              Motivated seller discovery, distress intelligence, and qualified lead handoff.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[var(--seller-silver)]">
              <span className="live-dot" /> Intelligence surface online
            </div>
          </div>

          <nav className="relative mt-5 space-y-2">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="seller-nav-link">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="seller-card relative mt-6 p-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--seller-gold)]">Mission Boundary</div>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Discovery and intelligence only. Qualified seller leads move forward; deal analysis stays downstream.
            </p>
          </div>
        </aside>
        <section className="min-w-0 space-y-5">{children}</section>
      </div>
    </main>
  );
}
