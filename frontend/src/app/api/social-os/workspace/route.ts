import { NextRequest, NextResponse } from "next/server";

import {
  deleteCampaign,
  duplicateCampaign,
  getSocialOsViewer,
  getSocialOsWorkspaceSnapshot,
  pushCampaign,
  removeIntegration,
  requestAdminIntegrationHelp,
  retryPlatformPush,
  saveBrandVoice,
  saveCampaign,
  saveIntegration,
  testIntegration,
} from "@/lib/social-os-server";
import type { SocialPlatform } from "@/types/social-os";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const viewer = await getSocialOsViewer();
    if (!viewer) throw new Error("Authentication required.");

    const clientSlug = request.nextUrl.searchParams.get("clientSlug");
    if (!clientSlug) {
      return NextResponse.json({ error: "clientSlug is required." }, { status: 400 });
    }

    return NextResponse.json({
      workspace: await getSocialOsWorkspaceSnapshot(clientSlug, viewer),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load workspace." },
      { status: 401 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await getSocialOsViewer();
    if (!viewer) throw new Error("Authentication required.");

    const body = (await request.json()) as {
      clientSlug?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };

    if (!body.clientSlug || !body.action) {
      return NextResponse.json({ error: "clientSlug and action are required." }, { status: 400 });
    }

    const current = await getSocialOsWorkspaceSnapshot(body.clientSlug, viewer);
    const clientId = current.client.id;
    const payload = body.payload ?? {};

    switch (body.action) {
      case "save-integration":
        await saveIntegration(clientId, viewer, {
          platform: payload.platform as SocialPlatform,
          apiKey: typeof payload.apiKey === "string" ? payload.apiKey : "",
          cliCommand: typeof payload.cliCommand === "string" ? payload.cliCommand : "",
          webhookUrl: typeof payload.webhookUrl === "string" ? payload.webhookUrl : "",
        });
        break;
      case "remove-integration":
        await removeIntegration(clientId, viewer, payload.platform as SocialPlatform);
        break;
      case "test-integration":
        await testIntegration(clientId, viewer, payload.platform as SocialPlatform);
        break;
      case "request-admin-integration-help":
        await requestAdminIntegrationHelp(clientId, viewer, {
          platform: payload.platform as SocialPlatform,
          preferredContact: typeof payload.preferredContact === "string" ? payload.preferredContact : "",
          requestNote: typeof payload.requestNote === "string" ? payload.requestNote : "",
        });
        break;
      case "save-campaign":
        await saveCampaign(clientId, viewer, {
          id: typeof payload.id === "string" ? payload.id : undefined,
          campaignName: String(payload.campaignName ?? ""),
          templateKey: String(payload.templateKey ?? ""),
          productName: String(payload.productName ?? ""),
          mainCaption: String(payload.mainCaption ?? ""),
          cta: String(payload.cta ?? ""),
          hashtags: Array.isArray(payload.hashtags) ? payload.hashtags.map(String) : [],
          productLink: String(payload.productLink ?? ""),
          shopLink: String(payload.shopLink ?? ""),
          selectedPlatforms: Array.isArray(payload.selectedPlatforms)
            ? (payload.selectedPlatforms as SocialPlatform[])
            : [],
          scheduledFor: typeof payload.scheduledFor === "string" ? payload.scheduledFor : null,
          videoAssetId: typeof payload.videoAssetId === "string" ? payload.videoAssetId : null,
          platformOverrides:
            typeof payload.platformOverrides === "object" && payload.platformOverrides
              ? payload.platformOverrides
              : undefined,
        });
        break;
      case "duplicate-campaign":
        await duplicateCampaign(clientId, viewer, String(payload.campaignId ?? ""));
        break;
      case "delete-campaign":
        await deleteCampaign(clientId, viewer, String(payload.campaignId ?? ""));
        break;
      case "push-campaign":
        await pushCampaign(clientId, viewer, String(payload.campaignId ?? ""), {
          platformsSelected: Boolean(payload.platformsSelected),
          captionApproved: Boolean(payload.captionApproved),
          ctaApproved: Boolean(payload.ctaApproved),
          productLinkApproved: Boolean(payload.productLinkApproved),
          videoFileApproved: Boolean(payload.videoFileApproved),
        });
        break;
      case "retry-platform":
        await retryPlatformPush(
          clientId,
          viewer,
          String(payload.campaignId ?? ""),
          payload.platform as SocialPlatform,
        );
        break;
      case "save-brand-voice":
        await saveBrandVoice(clientId, viewer, {
          tone: String(payload.tone ?? ""),
          hashtagStyle: String(payload.hashtagStyle ?? ""),
          ctaStyle: String(payload.ctaStyle ?? ""),
          emojiLevel: String(payload.emojiLevel ?? ""),
          productDescriptionStyle: String(payload.productDescriptionStyle ?? ""),
        });
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json({
      workspace: await getSocialOsWorkspaceSnapshot(body.clientSlug, viewer),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update workspace.";
    return NextResponse.json({ error: message }, { status: message === "Authentication required." ? 401 : 400 });
  }
}
