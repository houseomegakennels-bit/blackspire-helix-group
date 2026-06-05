import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MarketingShell } from "@/components/marketing-shell";
import { ReconAuthPanel } from "@/components/recon-auth-panel";
import { brandAssets } from "@/lib/brand-assets";
import { divisionThemeStyle } from "@/lib/division-theme";
import { getReconCustomer } from "@/lib/recon-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | Blackspire Recon Engine",
};

export default async function ReconLoginPage() {
  const customer = await getReconCustomer().catch(() => null);
  if (customer) redirect("/recon-engine/account");

  return (
    <MarketingShell watermarkLogoSrc={brandAssets.reconEngine.logo} themeStyle={divisionThemeStyle("recon-engine")}>
      <div
        className="theme-recon-engine mx-auto max-w-[1450px] px-4 py-16 lg:px-6"
        style={divisionThemeStyle("recon-engine")}
      >
        <div className="mb-8 text-center">
          <p className="cmd-text" style={{ color: "#c4b5fd" }}>BLACKSPIRE RECON ENGINE</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-black tracking-tight">Operator access</h1>
          <p className="mt-3 text-sm text-[var(--copy-soft)]">Sign in or create your Recon Engine account.</p>
        </div>
        <ReconAuthPanel />
      </div>
    </MarketingShell>
  );
}
