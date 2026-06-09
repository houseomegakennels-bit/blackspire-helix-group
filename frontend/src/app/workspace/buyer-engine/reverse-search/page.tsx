import { BuyerEngineReverseSearchPage } from "@/components/buyer-engine-reverse-search";
import { getOperatorShellStatus } from "@/lib/buyer-engine-server";

export const dynamic = "force-dynamic";

export default async function BuyerEngineReverseSearchWorkspacePage() {
  const operatorStatus = await getOperatorShellStatus().catch(() => null);
  return <BuyerEngineReverseSearchPage operatorStatus={operatorStatus} />;
}
