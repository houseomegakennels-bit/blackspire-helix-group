import type { Metadata } from "next";
import { SellerEngineDashboard } from "@/components/seller-engine-dashboard";
import { SellerEngineShell } from "@/components/seller-engine-shell";
import { listSellerAlerts, listSellerLeads, listSellerSources } from "@/lib/seller-engine-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Seller Engine | Blackspire Helix Group",
  description:
    "Operate the Blackspire Seller Engine workspace for motivated-seller intelligence, lead ranking, and outreach readiness.",
};

export default async function SellerEnginePage() {
  const [leads, alerts, sources] = await Promise.all([
    listSellerLeads().catch(() => []),
    listSellerAlerts().catch(() => []),
    listSellerSources().catch(() => []),
  ]);

  return <SellerEngineShell><SellerEngineDashboard initialLeads={leads} alerts={alerts as never[]} sources={sources as never[]} /></SellerEngineShell>;
}

