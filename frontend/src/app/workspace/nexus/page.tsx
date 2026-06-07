import { NexusHome } from "@/components/nexus-home";
import { getNexusSnapshot } from "@/lib/nexus-server";

export const dynamic = "force-dynamic";

export default async function NexusWorkspacePage() {
  const snapshot = await getNexusSnapshot();
  return <NexusHome snapshot={snapshot} />;
}
