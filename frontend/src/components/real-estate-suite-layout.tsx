import type { CSSProperties, ReactNode } from "react";

import { MarketingShell } from "@/components/marketing-shell";

export function RealEstateSuiteLayout({
  children,
  title = "Blackspire Real Estate Intelligence",
  description = "An organized operating system inside Blackspire Helix Group for seller discovery, contact intelligence, deal creation, and buyer activation.",
}: {
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  return (
    <MarketingShell
      themeStyle={
        {
          "--project-accent": "#D4AF37",
          "--project-glow": "rgba(212, 175, 55, 0.22)",
          "--project-surface": "rgba(212, 175, 55, 0.08)",
          "--project-edge": "rgba(198, 205, 214, 0.28)",
        } as CSSProperties
      }
    >
      <div className="mx-auto max-w-[1500px] px-4 py-8 lg:px-6 lg:py-10">
        <div className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
          <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Blackspire Helix Group Division</p>
          <h1 className="brand-display mt-3 text-4xl text-white lg:text-5xl">{title}</h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">{description}</p>
        </div>
        <div className="mt-6 space-y-6">{children}</div>
      </div>
    </MarketingShell>
  );
}
