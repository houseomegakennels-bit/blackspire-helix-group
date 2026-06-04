import { notFound } from "next/navigation";

import { DealEnginePacketView } from "@/components/deal-engine-packet-view";
import { getDealEngineDealDetail } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealEnginePacketPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const detail = await getDealEngineDealDetail(dealId);

  if (!detail) {
    notFound();
  }

  return <DealEnginePacketView dealId={dealId} detail={detail} />;
}
