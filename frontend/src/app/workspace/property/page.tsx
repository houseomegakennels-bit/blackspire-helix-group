import Link from "next/link";

import { listPropertiesForCommand } from "@/lib/property-server";

export const dynamic = "force-dynamic";

export default async function PropertyIndexPage() {
  const properties = await listPropertiesForCommand(60);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.1),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 lg:px-6 lg:py-10 space-y-6">
        <div className="brand-panel p-6 lg:p-7">
          <div className="text-[10px] uppercase tracking-[0.4em] text-[#5eead4]">Property Command</div>
          <h1 className="mt-2 text-3xl font-black tracking-[0.04em] text-white">Properties</h1>
          <p className="mt-2 text-sm text-[var(--copy-soft)]">
            Every property is a single source-of-truth record. Open one to see its seller, deal, buyers,
            contract, transaction, scores, and full timeline in one command view.
          </p>
        </div>

        <div className="space-y-2">
          {properties.length ? (
            properties.map((property) => (
              <Link
                key={property.id}
                href={`/workspace/property/${property.id}`}
                className="brand-panel flex items-center justify-between gap-4 p-4 transition hover:border-[#2dd4bf]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{property.address}</div>
                  <div className="mt-1 text-xs text-[var(--copy-soft)]">
                    {[property.city, property.county && `${property.county} County`, property.state].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {property.estimatedEquity != null ? (
                  <span className="shrink-0 text-sm text-[#5eead4]">${property.estimatedEquity.toLocaleString()} eq</span>
                ) : null}
              </Link>
            ))
          ) : (
            <div className="brand-panel p-6 text-sm text-[var(--copy-soft)]">No properties yet. Capture one in Harvester to begin.</div>
          )}
        </div>
      </div>
    </main>
  );
}
