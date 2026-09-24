import type { ReactNode } from "react";

import { requireSignedInPage } from "@/lib/operator-access";

export default async function SearchesLayout({ children }: { children: ReactNode }) {
  await requireSignedInPage();
  return children;
}
