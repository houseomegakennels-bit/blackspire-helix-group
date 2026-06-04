import { notFound } from "next/navigation";

import { DealRoomPublicView } from "@/components/deal-room-public-view";
import { getDealEngineDealRoomBySlug } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export default async function DealRoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getDealEngineDealRoomBySlug(slug);

  if (!detail) {
    notFound();
  }

  return <DealRoomPublicView detail={detail} />;
}
