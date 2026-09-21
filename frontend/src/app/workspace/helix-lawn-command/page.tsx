import { unstable_noStore as noStore } from "next/cache";

import { HelixLawnCommandHome } from "@/components/helix-lawn-command-home";
import { getHelixLawnCommandSnapshot } from "@/lib/helix-lawn-command-server";
import { requireSignedInPage } from "@/lib/operator-access";

export default async function HelixLawnCommandWorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requireSignedInPage();
  noStore();
  const resolvedSearchParams = await searchParams;
  const snapshot = await getHelixLawnCommandSnapshot();

  return <HelixLawnCommandHome snapshot={snapshot} initialTab={resolvedSearchParams?.tab} />;
}
