import { SellerEngineLaunchPage } from "@/components/seller-engine-launch-page";
import { requireSignedInPage } from "@/lib/operator-access";
import { SELLER_LIVE_SOURCES } from "@/lib/seller-engine";

export const dynamic = "force-dynamic";

export default async function NewSellerSweepPage() {
  await requireSignedInPage();
  const sources = SELLER_LIVE_SOURCES.map((source) => ({
    key: source.key,
    label: source.label,
    description: source.description,
  }));

  return <SellerEngineLaunchPage sources={sources} />;
}
