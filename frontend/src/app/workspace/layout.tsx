import type { ReactNode } from "react";

import { GlobalSearch } from "@/components/global-search";

// Wraps every /workspace/* surface so the global ⌘K search (jump to any property,
// deal, buyer, or owner) is available without losing context.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <GlobalSearch />
    </>
  );
}
