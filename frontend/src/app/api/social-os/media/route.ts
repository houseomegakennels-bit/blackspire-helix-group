import { NextResponse } from "next/server";

import {
  createMediaAsset,
  getSocialOsViewer,
  getSocialOsWorkspaceSnapshot,
} from "@/lib/social-os-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const viewer = await getSocialOsViewer();
    if (!viewer) throw new Error("Authentication required.");

    const formData = await request.formData();
    const clientSlug = formData.get("clientSlug");
    const file = formData.get("file");

    if (typeof clientSlug !== "string" || !clientSlug) {
      return NextResponse.json({ error: "clientSlug is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A media file is required." }, { status: 400 });
    }

    const workspace = await getSocialOsWorkspaceSnapshot(clientSlug, viewer);
    const arrayBuffer = await file.arrayBuffer();
    await createMediaAsset(workspace.client.id, viewer, {
      fileName: file.name,
      originalName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      buffer: Buffer.from(arrayBuffer),
    });

    return NextResponse.json({
      workspace: await getSocialOsWorkspaceSnapshot(clientSlug, viewer),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload media.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 400 });
  }
}
