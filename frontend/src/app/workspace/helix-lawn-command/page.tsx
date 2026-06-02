import { unstable_noStore as noStore } from "next/cache";

import { HelixLawnCommandHome } from "@/components/helix-lawn-command-home";
import { getHelixLawnCommandSnapshot } from "@/lib/helix-lawn-command-server";

export default async function HelixLawnCommandWorkspacePage() {
  noStore();
  const snapshot = await getHelixLawnCommandSnapshot();

  return <HelixLawnCommandHome snapshot={snapshot} />;
}
