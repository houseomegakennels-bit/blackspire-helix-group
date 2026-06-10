import Image from "next/image";
import Link from "next/link";

import { SentinelCommand } from "@/components/sentinel-command";
import { brandAssets } from "@/lib/brand-assets";
import { getSentinelWorkspaceSnapshot } from "@/lib/sentinel-server";

export const dynamic = "force-dynamic";

export default async function SentinelWorkspacePage() {
  const snapshot = await getSentinelWorkspaceSnapshot();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.12),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[1480px] px-4 py-8 lg:px-6 lg:py-10">
        <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
          <aside className="space-y-5">
            <div className="brand-card p-5">
              <Image
                src={brandAssets.sentinel.logo}
                alt="Blackspire Sentinel"
                width={260}
                height={150}
                className="mx-auto h-auto w-auto max-h-[120px] object-contain"
                priority
              />
              <div className="mt-4 text-xs uppercase tracking-[0.28em] text-[#5eead4]">
                Command Intelligence
              </div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                The executive command layer above Harvester, Seller Engine, Nexus, Deal Engine,
                Buyer Engine, and the Contract / Transaction centers.
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/workspace/harvester" className="harvester-mini-link">Harvester</Link>
                <Link href="/workspace/deal-engine" className="harvester-mini-link">Deal Engine</Link>
                <Link href="/seller-engine" className="harvester-mini-link">Seller Engine</Link>
              </div>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="brand-panel relative overflow-hidden p-6 lg:p-7">
              <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.4em] text-[#5eead4]">Sentinel Workspace</div>
                  <h1 className="mt-3 text-3xl font-black tracking-[0.05em] text-white sm:text-4xl">
                    Your command center for the day
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
                    Sentinel reads every engine, scores what matters, and tells you what needs
                    attention, which deal to work next, and where the value is — without hopping
                    between systems.
                  </p>
                </div>
                <div className="max-w-[300px]">
                  <Image
                    src={brandAssets.sentinel.logo}
                    alt="Blackspire Sentinel"
                    width={300}
                    height={170}
                    className="h-auto w-full object-contain"
                  />
                </div>
              </div>
            </div>

            <SentinelCommand snapshot={snapshot} />
          </section>
        </div>
      </div>
    </main>
  );
}
