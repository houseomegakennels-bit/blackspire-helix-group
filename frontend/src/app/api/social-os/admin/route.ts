import { NextRequest, NextResponse } from "next/server";

import {
  createClient,
  createClientLogin,
  getSocialOsAdminSnapshot,
  getSocialOsViewer,
  removeIntegration,
  resetClientPassword,
  saveIntegration,
  setClientAccess,
  testIntegration,
  updateAdminIntegrationRequest,
} from "@/lib/social-os-server";
import type { SocialCredentialAssistStatus, SocialPlatform } from "@/types/social-os";

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
      case "save-client-integration":
        await saveIntegration(String(payload.clientId ?? ""), viewer, {
          platform: payload.platform as SocialPlatform,
          apiKey: String(payload.apiKey ?? ""),
          cliCommand: String(payload.cliCommand ?? ""),
          webhookUrl: String(payload.webhookUrl ?? ""),
        });
        break;
      case "remove-client-integration":
        await removeIntegration(
          String(payload.clientId ?? ""),
          viewer,
          payload.platform as SocialPlatform,
        );
        break;
      case "test-client-integration":
        await testIntegration(
          String(payload.clientId ?? ""),
          viewer,
          payload.platform as SocialPlatform,
        );
        break;
      case "update-integration-request":
        await updateAdminIntegrationRequest(viewer, {
          clientId: String(payload.clientId ?? ""),
          platform: payload.platform as SocialPlatform,
          status: payload.status as SocialCredentialAssistStatus,
          preferredContact: typeof payload.preferredContact === "string" ? payload.preferredContact : "",
          requestNote: typeof payload.requestNote === "string" ? payload.requestNote : "",
          supportNote: typeof payload.supportNote === "string" ? payload.supportNote : "",
        });
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
