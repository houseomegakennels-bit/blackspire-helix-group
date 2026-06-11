import Link from "next/link";

import { requireSignedInPage } from "@/lib/operator-access";
import { SellerSweepForm } from "@/components/seller-sweep-form";
import { SELLER_LIVE_SOURCES } from "@/lib/seller-engine";
import { BetaFeedback } from "@/components/beta-feedback";

export const dynamic = "force-dynamic";

export default async function NewSellerSweepPage() {
  await requireSignedInPage();
  const sources = SELLER_LIVE_SOURCES.map((s) => ({ key: s.key, label: s.label, description: s.description }));

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.1),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[760px] px-4 py-8 lg:px-6 lg:py-10 space-y-6">
        <div className="flex items-center gap-3 text-xs">
          <Link href="/beta" className="text-[#5eead4] hover:underline">← Beta home</Link>
          <Link href="/seller-engine" className="text-[var(--copy-muted)] hover:text-white">Seller Engine</Link>
        </div>

        <div className="brand-panel p-6 lg:p-7">
          <div className="text-[10px] uppercase tracking-[0.4em] text-[#bbf7d0]">Seller Engine</div>
          <h1 className="mt-2 text-3xl font-black tracking-[0.04em] text-white">Launch Seller Sweep</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">
            Pull motivated-seller leads from live county / public-record sources, score their motivation, and import
            them straight into Seller Engine. (Looking to import a spreadsheet instead? Use <Link href="/seller-engine" className="text-[#5eead4] hover:underline">Import Seller CSV</Link> in Seller Engine.)
          </p>
        </div>

        <div className="brand-panel p-6 lg:p-7">
          <SellerSweepForm sources={sources} />
        </div>
      </div>
      <BetaFeedback />
    </main>
  );
}
