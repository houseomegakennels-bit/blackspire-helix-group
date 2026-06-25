import Link from "next/link";

import type { RealEstateEngineConfig } from "@/lib/real-estate-intelligence";
import { EngineStatusBadge } from "@/components/engine-status-badge";

export function EngineCard({ engine }: { engine: RealEstateEngineConfig }) {
  return (
    <div className="brand-panel card-lift scroll-reveal p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{engine.slug.replaceAll("-", " ")}</div>
        <EngineStatusBadge status={engine.status} />
      </div>
      <div className="mt-3 text-xl font-semibold text-white">{engine.name}</div>
      <div className="mt-1 text-sm font-medium brand-accent-text">{engine.tagline}</div>
      <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{engine.description}</div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={engine.ecosystemPath} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition">
          Ecosystem page
        </Link>
        <Link href={engine.workspacePath} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition">
          Workspace
        </Link>
      </div>
    </div>
  );
}
