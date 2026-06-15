import { NextRequest, NextResponse } from "next/server";

import {
  createClient,
  createClientLogin,
  getSocialOsAdminSnapshot,
  getSocialOsViewer,
  resetClientPassword,
  setClientAccess,
} from "@/lib/social-os-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await getSocialOsViewer();
    if (!viewer) throw new Error("Authentication required.");

    return NextResponse.json({
      admin: await getSocialOsAdminSnapshot(viewer),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin view.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await getSocialOsViewer();
    if (!viewer) throw new Error("Authentication required.");

    const body = (await request.json()) as {
      action?: string;
      payload?: Record<string, unknown>;
    };
    const payload = body.payload ?? {};

    switch (body.action) {
      case "create-client":
        await createClient(viewer, {
          name: String(payload.name ?? ""),
          slug: String(payload.slug ?? ""),
          brandName: String(payload.brandName ?? ""),
          username: String(payload.username ?? ""),
          password: String(payload.password ?? ""),
        });
        break;
      case "reset-password":
        await resetClientPassword(viewer, String(payload.userId ?? ""), String(payload.newPassword ?? ""));
        break;
      case "create-client-login":
        await createClientLogin(
          viewer,
          String(payload.clientId ?? ""),
          String(payload.username ?? ""),
          String(payload.password ?? ""),
        );
        break;
      case "set-client-access":
        await setClientAccess(viewer, String(payload.clientId ?? ""), Boolean(payload.disabled));
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json({
      admin: await getSocialOsAdminSnapshot(viewer),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update admin view.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 400 });
  }
}
