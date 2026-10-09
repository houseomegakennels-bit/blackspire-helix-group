import "./deal-workspace.css";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { brandAssets } from "@/lib/brand-assets";

/** Keep the property workspace focused on everyday work; other divisions remain in More. */
export function DealEngineShell({ children, home = false, light = home }: { children: ReactNode; home?: boolean; light?: boolean }) {
  return (
    <main className={`deal-workspace theme-deal-engine relative min-h-screen ${light ? "workspace-home" : "bg-[#0b1217]"}`}>
      <a href="#workspace-content" className="workspace-skip">Skip to property workspace</a>
      <div className="workspace-layout relative mx-auto grid min-h-screen max-w-[1800px] gap-5 px-3 py-3 lg:px-5">
        <aside className="workspace-sidebar brand-panel h-fit p-5 lg:sticky lg:top-20">
          <div className="workspace-identity">
            <Image src={brandAssets.dealEngine.logo} alt="" width={64} height={64} priority className="rounded-xl object-contain" />
            <div>
              <p className="text-sm text-[var(--copy-soft)]">Blackspire</p>
              <h1 className="text-xl font-semibold text-white">Property workspace</h1>
            </div>
          </div>
          <p className="workspace-introduction mt-4 text-sm leading-6 text-[var(--copy-soft)]">A place for your properties, people and next steps.</p>
          <nav aria-label="Property workspace" className="workspace-nav workspace-simple-nav mt-5">
            <Link href="/workspace/deal-engine" aria-current={home ? "page" : undefined}>Today</Link>
            <Link href="/workspace/deal-engine#property-queue">Your properties</Link>
            <details>
              <summary>People</summary>
              <div className="workspace-subnav">
                <Link href="/seller-engine">Seller leads</Link>
                <Link href="/workspace/nexus">Contact details</Link>
                <Link href="/workspace/buyer-engine">Buyer contacts</Link>
              </div>
            </details>
            <details>
              <summary>More</summary>
              <div className="workspace-subnav">
                <Link href="/workspace/harvester">Add a property</Link>
                <Link href="/workspace/property">Property research</Link>
                <Link href="/workspace/sentinel">Tasks and activity</Link>
                <Link href="/workspaces">All workspaces</Link>
                <Link href="/ecosystem/deal-engine">About Deal Engine</Link>
                <Link href="/ecosystem">Explore Blackspire</Link>
                <Link href="/">Blackspire home</Link>
              </div>
            </details>
          </nav>
          <p className="workspace-introduction mt-6 border-t border-[var(--line)] pt-4 text-sm leading-6 text-[var(--copy-soft)]">Open a property to review its numbers, save your progress or prepare the next step.</p>
        </aside>
        <section id="workspace-content" tabIndex={-1} className={`min-w-0 space-y-5 ${light ? "workspace-home-content" : ""}`}>{children}</section>
      </div>
    </main>
  );
}
