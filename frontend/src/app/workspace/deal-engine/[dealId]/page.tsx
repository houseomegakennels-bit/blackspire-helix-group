import { notFound } from "next/navigation";

import { DealEngineDealDetailView } from "@/components/deal-engine-deal-detail";
import { generateDealCommanderInsight, getDealEngineDealDetail, getDealTransactionCenter } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealEngineDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const [detail, commanderInsight, transactionCenter] = await Promise.all([
    getDealEngineDealDetail(dealId),
    generateDealCommanderInsight(dealId).catch(() => null),
    getDealTransactionCenter(dealId).catch(() => null),
  ]);

  if (!detail) {
    notFound();
  }

  return <DealEngineDealDetailView dealId={dealId} detail={detail} commanderInsight={commanderInsight} transactionCenter={transactionCenter} />;
}
