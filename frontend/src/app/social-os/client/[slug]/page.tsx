import { redirect } from "next/navigation";

import { SocialOsWorkspace } from "@/components/social-os/SocialOsWorkspace";
import {
  getClientWorkspacePath,
  getSocialOsViewer,
  getSocialOsWorkspaceSnapshot,
} from "@/lib/social-os-server";

export const dynamic = "force-dynamic";

export default async function SocialOsClientWorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getSocialOsViewer();

  if (!viewer) {
    redirect("/social-os/login");
  }

  if (!viewer.isAdmin && getClientWorkspacePath(viewer.clientId!) !== `/social-os/client/${slug}`) {
    redirect(getClientWorkspacePath(viewer.clientId!));
  }

  const workspace = await getSocialOsWorkspaceSnapshot(slug, viewer);
  return <SocialOsWorkspace initialWorkspace={workspace} />;
}
