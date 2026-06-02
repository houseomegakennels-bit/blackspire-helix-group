import { BuyerShell } from "@/components/buyer-shell";
import { CountySourcesAdmin } from "@/components/county-sources-admin";
import { getOperatorShellStatus, listAdminCountySourceRows } from "@/lib/buyer-engine-server";

export default async function CountySourcesPage() {
  const [operatorStatus, rows] = await Promise.all([
    getOperatorShellStatus().catch(() => null),
    listAdminCountySourceRows().catch(() => []),
  ]);

  return (
    <BuyerShell
      eyebrow="Admin"
      title="County Source Registry"
      description="Manage the CountyDataSource registry. Toggle active/inactive to include or exclude counties from buyer sweeps. Only active sources are included in n8n workflow runs. Changes propagate immediately — the workflow picks up new state on its next run."
      operatorStatus={operatorStatus}
    >
      <CountySourcesAdmin initialRows={rows} />
    </BuyerShell>
  );
}
