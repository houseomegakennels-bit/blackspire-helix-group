import { unstable_noStore as noStore } from "next/cache";

import { HelixLawnCommandHome } from "@/components/helix-lawn-command-home";
import { getHelixLawnCommandSnapshot } from "@/lib/helix-lawn-command-server";

export default async function HelixLawnCommandWorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  noStore();
  const resolvedSearchParams = await searchParams;
  const snapshot = await getHelixLawnCommandSnapshot();

  return <HelixLawnCommandHome snapshot={snapshot} initialTab={resolvedSearchParams?.tab} />;
}
