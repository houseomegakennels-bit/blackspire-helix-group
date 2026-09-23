import { BuyerShell } from "@/components/buyer-shell";
import { DemoAccessAdmin } from "@/components/demo-access-admin";
import { requireAdminPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export default async function DemoAccessPage() {
  await requireAdminPage();
  return <BuyerShell eyebrow="Admin" title="Temporary Demo Access" description="Create a private one-time link so a client can choose their own email and password for the protected, read-only walkthrough."><DemoAccessAdmin /></BuyerShell>;
}
