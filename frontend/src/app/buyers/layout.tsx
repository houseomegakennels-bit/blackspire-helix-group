import type { ReactNode } from "react";

import { requireSignedInPage } from "@/lib/operator-access";

export default async function BuyersLayout({ children }: { children: ReactNode }) {
  await requireSignedInPage();
  return children;
}
