import { HarvesterHome } from "@/components/harvester-home";
import { getHarvesterWorkspaceSnapshot } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export default async function HarvesterWorkspacePage() {
  const snapshot = await getHarvesterWorkspaceSnapshot();
  return <HarvesterHome snapshot={snapshot} />;
}
