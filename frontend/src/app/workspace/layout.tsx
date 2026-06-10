import type { ReactNode } from "react";

import { GlobalSearch } from "@/components/global-search";
import { WorkspaceNav } from "@/components/workspace-nav";

// Wraps every /workspace/* surface with a consistent cross-workspace nav (so
// Sentinel and every engine are reachable from anywhere) plus the global ⌘K
// search — navigation stays familiar without losing context.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      {children}
      <GlobalSearch />
    </>
  );
}
