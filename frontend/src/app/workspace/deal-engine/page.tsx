import { DealEngineHome } from "@/components/deal-engine-home";
import { getDealEngineWorkspaceSnapshot } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealEngineWorkspacePage() {
  const snapshot = await getDealEngineWorkspaceSnapshot();

  return <DealEngineHome snapshot={snapshot} />;
}
