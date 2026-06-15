import { redirect } from "next/navigation";

import { SocialOsAdminConsole } from "@/components/social-os/SocialOsAdminConsole";
import {
  getClientWorkspacePath,
  getSocialOsAdminSnapshot,
  getSocialOsViewer,
} from "@/lib/social-os-server";

export const dynamic = "force-dynamic";

export default async function SocialOsAdminPage() {
  const viewer = await getSocialOsViewer();

  if (!viewer) {
    redirect("/social-os/login");
  }

  if (!viewer.isAdmin) {
    redirect(getClientWorkspacePath(viewer.clientId!));
  }

  const admin = await getSocialOsAdminSnapshot(viewer);
  return <SocialOsAdminConsole initialAdmin={admin} />;
}
