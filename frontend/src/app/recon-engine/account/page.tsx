import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { ReconAccountPanel } from "@/components/recon-account-panel";
import { getReconCustomer } from "@/lib/recon-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account | Blackspire Recon Engine",
};

export default async function ReconAccountPage() {
  const account = await getReconCustomer().catch(() => null);

  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] space-y-8 px-4 py-16 lg:px-6">
        <section className="brand-panel px-6 py-8">
          <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Recon Engine / Account</p>
          <h1 className="brand-accent-text mt-3 text-4xl font-black tracking-tight">Your Recon account</h1>
        </section>

        {account ? (
          <ReconAccountPanel account={account} />
        ) : (
          <section className="brand-panel px-6 py-8 text-center">
            <h2 className="brand-display text-2xl text-white">You&apos;re not signed in</h2>
            <p className="mt-2 text-sm text-[var(--copy-soft)]">Sign in or create a Recon Engine account to manage your profile, plan, and referral link.</p>
            <Link href="/recon-engine/login" className="recon-button mt-5 inline-flex px-6 py-3 text-sm uppercase tracking-[0.18em]">
              Sign in / Create account
            </Link>
          </section>
        )}
      </div>
    </MarketingShell>
  );
}
