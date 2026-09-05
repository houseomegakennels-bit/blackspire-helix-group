import type { ReactNode } from "react";

import { requireAdminPage } from "@/lib/operator-access";

export default async function SellerEngineLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return children;
}
