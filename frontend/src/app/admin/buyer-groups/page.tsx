import { BuyerShell } from "@/components/buyer-shell";
import { BuyerGroupsAdmin } from "@/components/buyer-groups-admin";
import { getOperatorShellStatus, listBuyerGroupRegistry } from "@/lib/buyer-engine-server";
import { requireAdminPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export default async function BuyerGroupsAdminPage() {
  await requireAdminPage();
  const [operatorStatus, rows] = await Promise.all([
    getOperatorShellStatus().catch(() => null),
    listBuyerGroupRegistry(true).catch(() => []),
  ]);

  return (
    <BuyerShell
      eyebrow="Admin"
      title="Buyer Group Registry"
      description="Manage hedge fund and institutional buyer aliases that enrich Buyer Engine reports after county transaction discovery."
      operatorStatus={operatorStatus}
    >
      <BuyerGroupsAdmin initialRows={rows} />
    </BuyerShell>
  );
}
