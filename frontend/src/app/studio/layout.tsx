import type { ReactNode } from "react";

import { WorkspaceNav } from "@/components/workspace-nav";
import { BetaFeedback } from "@/components/beta-feedback";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      {children}
      <BetaFeedback />
    </>
  );
}
