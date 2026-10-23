import { getPropertyWorkboard } from "@/lib/property-workboard-server";
import { requireAdminPage } from "@/lib/operator-access";
import { DealEngineHome } from "@/components/deal-engine-home";
import { getDealEngineWorkspaceSnapshot } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealEngineWorkspacePage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  await requireAdminPage();
  const { page } = await searchParams;
  const requestedPage = typeof page === "string" && /^\d+$/.test(page) ? Number(page) : 1;
  const [snapshot, workboard] = await Promise.all([getDealEngineWorkspaceSnapshot(requestedPage), getPropertyWorkboard()]);

  return <DealEngineHome snapshot={snapshot} workboard={workboard} />;
}
