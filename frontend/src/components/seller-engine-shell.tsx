import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { BetaFeedback } from "@/components/beta-feedback";
import { DivisionWatermark } from "@/components/division-watermark";
import { RealEstateWorkflowRail } from "@/components/real-estate-workflow-rail";
import { brandAssets } from "@/lib/brand-assets";

const navItems = [
  { href: "/workspace/seller-engine", label: "Command Deck" },
  { href: "/workspace/seller-engine/new", label: "Launch Sweep" },
  { href: "/seller-engine#leads", label: "Seller Leads" },
  { href: "/seller-engine#harvester", label: "Data Harvester" },
  { href: "/seller-engine#alerts", label: "Alerts" },
  { href: "/seller-engine#settings", label: "Scoring Settings" },
  { href: "/workspace/nexus", label: "Nexus" },
  { href: "/workspace/deal-engine", label: "Deal Engine" },
  { href: "/workspace/buyer-engine", label: "Buyer Engine" },
  { href: "/", label: "Blackspire Helix" },
];

export function SellerEngineShell({ children }: { children: ReactNode }) {
  return (
    <main className="seller-shell relative min-h-screen overflow-hidden text-foreground">
      <DivisionWatermark logoSrc={brandAssets.sellerEngine.logo} />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1800px] gap-5 px-3 py-3 lg:grid-cols-[270px_minmax(0,1fr)] lg:px-5">
        <aside className="seller-panel h-fit overflow-hidden p-5 lg:sticky lg:top-3">
          <div className="seller-radar" />
          <div className="relative border-b border-[var(--seller-line)] pb-5">
            <div className="mb-4 overflow-hidden rounded-[24px] border border-[var(--seller-line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(0_0%_2%/.96))] px-3 py-4">
              <div className="relative mx-auto h-[100px] w-full max-w-[140px] sm:h-[148px] sm:max-w-[208px]">
                <Image
                  src={brandAssets.sellerEngine.logo}
                  alt={brandAssets.sellerEngine.name}
                  fill
                  priority
                  className="object-contain"
                  sizes="(max-width: 640px) 140px, 208px"
                />
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-[0.48em] text-[var(--seller-silver)]">Blackspire Helix Group</p>
            <h1 className="brand-display mt-3 text-2xl text-white sm:text-3xl">{brandAssets.sellerEngine.name}</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
              Motivated seller discovery, distress intelligence, and qualified lead handoff into Nexus or Deal Engine.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[var(--seller-silver)]">
              <span className="live-dot" /> Intelligence surface online
            </div>
          </div>

          <nav className="relative mt-5 hidden space-y-2 lg:block">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="seller-nav-link">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="seller-card relative mt-6 hidden p-4 lg:block">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--seller-gold)]">Mission Boundary</div>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Discovery and intelligence only. Qualified seller leads move into Nexus first by default; deal analysis stays downstream.
            </p>
          </div>
          <div className="hidden lg:block">
            <RealEstateWorkflowRail active="seller" compact />
          </div>
        </aside>
        <section className="min-w-0 space-y-5">{children}</section>
      </div>
      <BetaFeedback />
    </main>
  );
}
