import { DealEngineHome } from "@/components/deal-engine-home";
import { getDealEngineWorkspaceSnapshot } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealEngineWorkspacePage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { page } = await searchParams;
  const requestedPage = typeof page === "string" && /^\d+$/.test(page) ? Number(page) : 1;
  const snapshot = await getDealEngineWorkspaceSnapshot(requestedPage);

  return <DealEngineHome snapshot={snapshot} />;
}
