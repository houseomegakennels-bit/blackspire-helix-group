import { notFound } from "next/navigation";

import { DealEngineDealDetailView } from "@/components/deal-engine-deal-detail";
import { getDealEngineDealDetail } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealEngineDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const detail = await getDealEngineDealDetail(dealId);

  if (!detail) {
    notFound();
  }

  return <DealEngineDealDetailView dealId={dealId} detail={detail} />;
}
