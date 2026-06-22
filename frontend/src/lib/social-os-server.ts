import "server-only";

import crypto from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAdminSupabaseAuthClient,
  createPublicSupabaseAuthClient,
  getAuthenticatedOperator,
  isAuthenticatedOperatorAdmin,
  listAuthUsers,
  type AuthAdminUserRecord,
} from "@/lib/buyer-engine-auth";
import type {
  SocialAdminSnapshot,
  SocialAuditLogRecord,
  SocialBrandVoiceSettings,
  SocialCampaignRecord,
  SocialCampaignStatus,
  SocialCampaignTemplate,
  SocialClientRecord,
  SocialClientUserRecord,
  SocialConnectionStatus,
  SocialIntegrationRecord,
  SocialMediaAssetRecord,
  SocialOnboardingChecklistItem,
  SocialPlatform,
  SocialPlatformPostRecord,
  SocialPostStatus,
  SocialViewer,
  SocialWorkspaceSnapshot,
} from "@/types/social-os";

const SOCIAL_OS_BUCKET = "blackspire-social-os";
const SOCIAL_OS_STATE_PATH = "system/state.json";
const STATE_VERSION = 1;

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  "tiktok-shop": "TikTok Shop",
  instagram: "Instagram Reel",
  facebook: "Facebook Reel",
  x: "X Video Post",
};

export const socialOsTabs: SocialWorkspaceSnapshot["tabs"] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "upload", label: "Upload" },
  { id: "campaigns", label: "Campaigns" },
  { id: "media-library", label: "Media Library" },
  { id: "integrations", label: "Integrations" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

export const campaignTemplates: SocialCampaignTemplate[] = [
  {
    key: "product-demo",
    name: "Product demo",
    description: "Show the product clearly with a benefit-first walkthrough.",
    defaultCaptionPrompt: "Lead with the clearest product benefit, then show how it solves the problem fast.",
    defaultCta: "Watch it in action and tap through.",
  },
  {
    key: "testimonial-ugc",
    name: "Testimonial style UGC",
    description: "A social-proof angle with creator-style delivery.",
    defaultCaptionPrompt: "Use an authentic testimonial voice with one clean result and one believable proof point.",
    defaultCta: "See why people are switching.",
  },
  {
    key: "problem-solution",
    name: "Problem/solution ad",
    description: "Open with the pain point, then resolve it quickly.",
    defaultCaptionPrompt: "Call out the problem first, reveal the fix, and end on the visible transformation.",
    defaultCta: "Fix the problem before your next scroll.",
  },
  {
    key: "flash-sale",
    name: "Flash sale",
    description: "Urgency-forward campaign built for fast action.",
    defaultCaptionPrompt: "Frame this as a short-timer with clear urgency, offer clarity, and one fast reason to act now.",
    defaultCta: "Grab the flash sale before it disappears.",
  },
  {
    key: "new-product-launch",
    name: "New product launch",
    description: "Premium positioning for a fresh release.",
    defaultCaptionPrompt: "Introduce the new release, explain why it matters, and give one reason to buy now.",
    defaultCta: "Be first to get the new drop.",
  },
  {
    key: "retargeting",
    name: "Retargeting ad",
    description: "Re-engage warm traffic with lower-friction messaging.",
    defaultCaptionPrompt: "Speak to people who already showed interest and remove the last bit of hesitation.",
    defaultCta: "Come back and finish the order.",
  },
];

const ONBOARDING_ITEMS: Array<{ key: string; label: string }> = [
  { key: "login-created", label: "Login created" },
  { key: "tiktok-connected", label: "TikTok connected" },
  { key: "tiktok-shop-connected", label: "TikTok Shop connected" },
  { key: "instagram-connected", label: "Instagram connected" },
  { key: "facebook-connected", label: "Facebook connected" },
  { key: "x-connected", label: "X connected" },
  { key: "first-reel-uploaded", label: "First reel uploaded" },
  { key: "first-campaign-pushed", label: "First campaign pushed" },
];

type SocialStoredIntegration = SocialIntegrationRecord & {
  encryptedApiKey: string | null;
  encryptedCliCommand: string | null;
  encryptedWebhookUrl: string | null;
};

type SocialWorkspaceState = {
  integrations: SocialStoredIntegration[];
  mediaLibrary: SocialMediaAssetRecord[];
  brandVoice: SocialBrandVoiceSettings;
  campaigns: SocialCampaignRecord[];
};

type SocialState = {
  version: number;
  clients: SocialClientRecord[];
  workspaces: Record<string, SocialWorkspaceState>;
  auditLogs: SocialAuditLogRecord[];
};

type AuthUserWithMeta = AuthAdminUserRecord & {
  email: string | null;
  user_metadata: Record<string, unknown> | null;
};

type SaveIntegrationInput = {
  platform: SocialPlatform;
  apiKey?: string;
  cliCommand?: string;
  webhookUrl?: string;
};

type SaveCampaignInput = {
  id?: string;
  campaignName: string;
  templateKey: string;
  productName: string;
  mainCaption: string;
  cta: string;
  hashtags: string[];
  productLink: string;
  shopLink: string;
  selectedPlatforms: SocialPlatform[];
  scheduledFor?: string | null;
  videoAssetId?: string | null;
  platformOverrides?: Partial<
    Record<
      SocialPlatform,
      {
        caption?: string;
        hashtags?: string[];
        cta?: string;
        productLink?: string;
        shopLink?: string;
      }
    >
  >;
};

type PushReviewInput = {
  platformsSelected: boolean;
  captionApproved: boolean;
  ctaApproved: boolean;
  productLinkApproved: boolean;
  videoFileApproved: boolean;
};

type SaveBrandVoiceInput = {
  tone: string;
  hashtagStyle: string;
  ctaStyle: string;
  emojiLevel: string;
  productDescriptionStyle: string;
};

type CreateClientInput = {
  name: string;
  slug: string;
  brandName: string;
  username: string;
  password: string;
};

type CreateMediaInput = {
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  buffer: Buffer;
};

type AuthResult = {
  accessToken: string;
  refreshToken: string;
  redirectPath: string;
};

export async function authenticateSocialOsUser(username: string, password: string): Promise<AuthResult> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !password) {
    throw new Error("Username and password are required.");
  }

  const [users, state] = await Promise.all([listSocialAuthUsers(), readSocialOsState()]);
  const match = users.find((user) => matchesUsername(user, normalizedUsername));

  if (!match?.email) {
    await recordAuditLog({
      clientId: null,
      actorUsername: normalizedUsername,
      eventType: "login_attempt",
      entityType: "auth",
      entityId: null,
      message: "Failed Social OS login attempt.",
      metadata: { username: normalizedUsername },
    });
    throw new Error("Invalid username or password.");
  }

  const viewer = await buildViewerFromAuthUser(match, state, users);
  if (!viewer) {
    await recordAuditLog({
      clientId: null,
      actorUsername: normalizedUsername,
      eventType: "login_attempt",
      entityType: "auth",
      entityId: match.id,
      message: "Blocked Social OS login attempt for unauthorized user.",
      metadata: { username: normalizedUsername },
    });
    throw new Error("This account does not have Social OS access.");
  }

  if (viewer.clientId) {
    const client = state.clients.find((item) => item.id === viewer.clientId);
    if (client?.disabledAt) {
      throw new Error("This workspace is currently disabled.");
    }
  }

  const supabase = createPublicSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: match.email,
    password,
  });

  if (error || !data.session || !data.user) {
    await recordAuditLog({
      clientId: viewer.clientId,
      actorUsername: normalizedUsername,
      eventType: "login_attempt",
      entityType: "auth",
      entityId: match.id,
      message: "Failed Social OS login attempt.",
      metadata: { username: normalizedUsername },
    });
    throw new Error(error?.message ?? "Invalid username or password.");
  }

  await recordAuditLog({
    clientId: viewer.clientId,
    actorUsername: viewer.username,
    eventType: "login_attempt",
    entityType: "auth",
    entityId: viewer.userId,
    message: "Successful Social OS login.",
    metadata: { username: viewer.username },
  });

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    redirectPath: viewer.isAdmin
      ? "/social-os/admin"
      : getClientWorkspacePath(viewer.clientId!, state),
  };
}

export async function getSocialOsViewer(): Promise<SocialViewer | null> {
  const operator = await getAuthenticatedOperator();
  if (!operator) {
    return null;
  }

  const state = await readSocialOsState();
  const users = await listSocialAuthUsers();
  const match = users.find((user) => user.id === operator.id);
  if (!match) {
    return null;
  }

  return buildViewerFromAuthUser(match, state, users);
}

export async function getSocialOsWorkspaceSnapshot(
  clientSlug: string,
  viewer: SocialViewer,
): Promise<SocialWorkspaceSnapshot> {
  const state = await readSocialOsState();
  const client = state.clients.find((item) => item.slug === clientSlug);
  if (!client) {
    throw new Error("Workspace not found.");
  }

  authorizeClientAccess(client.id, viewer);

  if (client.disabledAt && !viewer.isAdmin) {
    throw new Error("This workspace is currently disabled.");
  }

  const workspace = ensureWorkspace(state, client);
  const clientUsers = (await listSocialAuthUsers()).filter((user) =>
    getMetaText(user.user_metadata, "social_os_client_id") === client.id,
  );

  const onboardingChecklist = buildOnboardingChecklist({
    clientId: client.id,
    integrations: workspace.integrations,
    mediaLibrary: workspace.mediaLibrary,
    campaigns: workspace.campaigns,
    clientUsers,
  });

  const failedPosts = workspace.campaigns.flatMap((campaign) =>
    campaign.posts.filter((post) => post.status === "failed"),
  );

  const publicIntegrations = workspace.integrations.map(toPublicIntegration);
  const publicCampaigns = workspace.campaigns
    .map((campaign) => hydrateCampaign(campaign, workspace.mediaLibrary))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const publicMedia = [...workspace.mediaLibrary].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );

  return {
    client,
    viewer,
    tabs: socialOsTabs,
    templates: campaignTemplates,
    onboardingChecklist,
    integrations: publicIntegrations,
    connectionHealth: {
      connected: publicIntegrations.filter((item) => item.connectionStatus === "connected").length,
      attentionNeeded: publicIntegrations.filter((item) => item.connectionStatus !== "connected").length,
      lastSuccessfulPush: getLatestDate(publicIntegrations.map((item) => item.lastSuccessfulPush)),
      lastFailedPush: getLatestDate(publicIntegrations.map((item) => item.lastFailedPush)),
    },
    campaigns: publicCampaigns,
    mediaLibrary: publicMedia,
    brandVoice: workspace.brandVoice,
    auditLogs: state.auditLogs
      .filter((log) => log.clientId === null || log.clientId === client.id)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 80),
    dashboard: {
      activeCampaigns: publicCampaigns.filter((campaign) =>
        ["ready", "posting", "scheduled"].includes(campaign.status),
      ).length,
      draftCampaigns: publicCampaigns.filter((campaign) =>
        campaign.status === "draft" || campaign.status === "needs review",
      ).length,
      postedCampaigns: publicCampaigns.filter((campaign) => campaign.status === "posted").length,
      failedPushes: failedPosts.length,
      recentUploads: publicMedia.filter((asset) => daysSince(asset.createdAt) <= 14).length,
    },
  };
}

export async function getSocialOsAdminSnapshot(viewer: SocialViewer): Promise<SocialAdminSnapshot> {
  if (!viewer.isAdmin) {
    throw new Error("Admin access required.");
  }

  const [state, users] = await Promise.all([readSocialOsState(), listSocialAuthUsers()]);
  const clients = state.clients.map((client) => {
    const workspace = ensureWorkspace(state, client);
    const clientUsers = users
      .filter((user) => getMetaText(user.user_metadata, "social_os_client_id") === client.id)
      .map((user) => mapAuthUserToClientUser(user, client.disabledAt));

    return {
      ...client,
      users: clientUsers,
      integrations: workspace.integrations.map(toPublicIntegration),
      failedPushes: workspace.campaigns.flatMap((campaign) =>
        campaign.posts
          .filter((post) => post.status === "failed")
          .map((post) => ({
            campaignName: campaign.campaignName,
            platformLabel: post.platformLabel,
            errorMessage: post.errorMessage ?? "Unknown failure.",
            updatedAt: post.updatedAt,
          })),
      ),
    };
  });

  return {
    viewer,
    clients,
    auditLogs: [...state.auditLogs]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 120),
  };
}

export async function saveIntegration(
  clientId: string,
  viewer: SocialViewer,
  input: SaveIntegrationInput,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const current = workspace.integrations.find((item) => item.platform === input.platform);
  if (!current) {
    throw new Error("Platform integration not found.");
  }

  const now = new Date().toISOString();
  const apiKey = input.apiKey?.trim() ?? "";
  const cliCommand = input.cliCommand?.trim() ?? "";
  const webhookUrl = input.webhookUrl?.trim() ?? "";

  current.encryptedApiKey = apiKey ? encryptSecret(apiKey) : current.encryptedApiKey;
  current.encryptedCliCommand = cliCommand ? encryptSecret(cliCommand) : current.encryptedCliCommand;
  current.encryptedWebhookUrl = webhookUrl ? encryptSecret(webhookUrl) : current.encryptedWebhookUrl;
  current.maskedApiKey = apiKey ? maskSecret(apiKey) : current.maskedApiKey;
  current.maskedCliCommand = cliCommand ? maskCommand(cliCommand) : current.maskedCliCommand;
  current.maskedWebhookUrl = webhookUrl ? maskUrl(webhookUrl) : current.maskedWebhookUrl;
  current.connectionStatus = determineSavedIntegrationStatus(current);
  current.lastError = null;
  current.updatedAt = now;

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "credential_update",
    entityType: "integration",
    entityId: current.id,
    message: `${current.platformLabel} credentials updated.`,
    metadata: { platform: current.platform },
  });

  await writeSocialOsState(state);
}

export async function removeIntegration(
  clientId: string,
  viewer: SocialViewer,
  platform: SocialPlatform,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const current = workspace.integrations.find((item) => item.platform === platform);
  if (!current) {
    throw new Error("Platform integration not found.");
  }

  current.encryptedApiKey = null;
  current.encryptedCliCommand = null;
  current.encryptedWebhookUrl = null;
  current.maskedApiKey = null;
  current.maskedCliCommand = null;
  current.maskedWebhookUrl = null;
  current.connectionStatus = "not connected";
  current.lastError = null;
  current.updatedAt = new Date().toISOString();

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "credential_update",
    entityType: "integration",
    entityId: current.id,
    message: `${current.platformLabel} credentials removed.`,
    metadata: { platform },
  });

  await writeSocialOsState(state);
}

export async function testIntegration(
  clientId: string,
  viewer: SocialViewer,
  platform: SocialPlatform,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const current = workspace.integrations.find((item) => item.platform === platform);
  if (!current) {
    throw new Error("Platform integration not found.");
  }

  const now = new Date().toISOString();
  const credentialBundle = [
    current.encryptedApiKey ? decryptSecret(current.encryptedApiKey) : "",
    current.encryptedCliCommand ? decryptSecret(current.encryptedCliCommand) : "",
    current.encryptedWebhookUrl ? decryptSecret(current.encryptedWebhookUrl) : "",
  ].join(" ").toLowerCase();

  if (!current.maskedApiKey && !current.maskedCliCommand && !current.maskedWebhookUrl) {
    current.connectionStatus = "not connected";
    current.lastError = "No credentials saved yet.";
  } else if (credentialBundle.includes("expired")) {
    current.connectionStatus = "token expired";
    current.lastError = "Token expired. Reconnect before posting.";
  } else if (credentialBundle.includes("reconnect")) {
    current.connectionStatus = "needs reconnect";
    current.lastError = "Connection needs reconnect before posting.";
  } else {
    current.connectionStatus = "connected";
    current.lastError = null;
  }

  current.lastTestedAt = now;
  current.updatedAt = now;

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "connection_test",
    entityType: "integration",
    entityId: current.id,
    message: `${current.platformLabel} connection tested.`,
    metadata: { platform, status: current.connectionStatus },
  });

  await writeSocialOsState(state);
}

export async function createMediaAsset(
  clientId: string,
  viewer: SocialViewer,
  input: CreateMediaInput,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const assetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const storedPath = `media/${client.slug}/${assetId}-${sanitizeFileName(input.fileName)}`;

  const supabase = getSupabaseStorageClient();
  await ensureSocialOsBucket(supabase);
  const { error } = await supabase.storage.from(SOCIAL_OS_BUCKET).upload(storedPath, input.buffer, {
    contentType: input.mimeType || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw new Error(`Unable to upload media: ${error.message}`);
  }

  workspace.mediaLibrary.unshift({
    id: assetId,
    clientId,
    fileName: sanitizeFileName(input.fileName),
    originalName: input.originalName.trim() || input.fileName.trim(),
    storedPath,
    mimeType: input.mimeType || "application/octet-stream",
    fileSize: input.fileSize,
    durationLabel: "Short-form reel",
    createdAt: now,
    updatedAt: now,
  });

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "media_upload",
    entityType: "media_asset",
    entityId: assetId,
    message: `${input.originalName.trim() || input.fileName.trim()} uploaded to the media library.`,
    metadata: { storedPath },
  });

  await writeSocialOsState(state);
}

export async function saveCampaign(
  clientId: string,
  viewer: SocialViewer,
  input: SaveCampaignInput,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const normalized = normalizeCampaignInput(input);
  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const now = new Date().toISOString();
  const assetName =
    workspace.mediaLibrary.find((asset) => asset.id === normalized.videoAssetId)?.originalName ?? null;

  const existing = normalized.id
    ? workspace.campaigns.find((campaign) => campaign.id === normalized.id)
    : undefined;

  const base: SocialCampaignRecord = existing ?? {
    id: crypto.randomUUID(),
    clientId,
    campaignName: normalized.campaignName,
    templateKey: normalized.templateKey,
    productName: normalized.productName,
    mainCaption: normalized.mainCaption,
    cta: normalized.cta,
    hashtags: normalized.hashtags,
    productLink: normalized.productLink,
    shopLink: normalized.shopLink,
    selectedPlatforms: normalized.selectedPlatforms,
    status: "draft",
    scheduledFor: normalized.scheduledFor,
    videoAssetId: normalized.videoAssetId,
    videoAssetName: assetName,
    brandVoiceSnapshot: pickBrandVoiceSnapshot(workspace.brandVoice),
    createdAt: now,
    updatedAt: now,
    lastPushAt: null,
    posts: [],
  };

  base.campaignName = normalized.campaignName;
  base.templateKey = normalized.templateKey;
  base.productName = normalized.productName;
  base.mainCaption = normalized.mainCaption;
  base.cta = normalized.cta;
  base.hashtags = normalized.hashtags;
  base.productLink = normalized.productLink;
  base.shopLink = normalized.shopLink;
  base.selectedPlatforms = normalized.selectedPlatforms;
  base.scheduledFor = normalized.scheduledFor;
  base.videoAssetId = normalized.videoAssetId;
  base.videoAssetName = assetName;
  base.brandVoiceSnapshot = pickBrandVoiceSnapshot(workspace.brandVoice);
  base.updatedAt = now;
  base.posts = syncPlatformPosts(base.posts, base.id, normalized);
  base.status = determineCampaignStatus(base);

  if (existing) {
    const index = workspace.campaigns.findIndex((campaign) => campaign.id === existing.id);
    workspace.campaigns[index] = base;
  } else {
    workspace.campaigns.unshift(base);
  }

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: existing ? "campaign_edit" : "campaign_creation",
    entityType: "campaign",
    entityId: base.id,
    message: existing
      ? `${base.campaignName} updated.`
      : `${base.campaignName} created.`,
    metadata: {
      selectedPlatforms: base.selectedPlatforms,
      scheduledFor: base.scheduledFor,
    },
  });

  await writeSocialOsState(state);
}

export async function duplicateCampaign(
  clientId: string,
  viewer: SocialViewer,
  campaignId: string,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const source = workspace.campaigns.find((campaign) => campaign.id === campaignId);
  if (!source) {
    throw new Error("Campaign not found.");
  }

  const now = new Date().toISOString();
  const duplicateId = crypto.randomUUID();
  const duplicate: SocialCampaignRecord = {
    ...source,
    id: duplicateId,
    campaignName: `${source.campaignName} Copy`,
    status: determineCampaignStatus(source),
    createdAt: now,
    updatedAt: now,
    lastPushAt: null,
    posts: source.posts.map((post) => ({
      ...post,
      id: crypto.randomUUID(),
      campaignId: duplicateId,
      status: post.status === "posted" ? "ready" : post.status,
      errorMessage: null,
      responseLog: null,
      lastAttemptAt: null,
      postedAt: null,
      retryCount: 0,
      updatedAt: now,
    })),
  };
  duplicate.status = determineCampaignStatus(duplicate);

  workspace.campaigns.unshift(duplicate);

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "campaign_creation",
    entityType: "campaign",
    entityId: duplicate.id,
    message: `${source.campaignName} duplicated.`,
    metadata: { sourceCampaignId: source.id },
  });

  await writeSocialOsState(state);
}

export async function deleteCampaign(
  clientId: string,
  viewer: SocialViewer,
  campaignId: string,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const campaign = workspace.campaigns.find((item) => item.id === campaignId);
  workspace.campaigns = workspace.campaigns.filter((item) => item.id !== campaignId);

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "campaign_delete",
    entityType: "campaign",
    entityId: campaignId,
    message: `${campaign?.campaignName ?? "Campaign"} deleted.`,
    metadata: {},
  });

  await writeSocialOsState(state);
}

export async function pushCampaign(
  clientId: string,
  viewer: SocialViewer,
  campaignId: string,
  review: PushReviewInput,
): Promise<void> {
  validateReviewChecklist(review);

  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const campaign = workspace.campaigns.find((item) => item.id === campaignId);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  campaign.status = "posting";
  const now = new Date().toISOString();
  campaign.updatedAt = now;

  for (const post of campaign.posts.filter((item) => campaign.selectedPlatforms.includes(item.platform))) {
    attemptPlatformPush(state, clientId, workspace.integrations, campaign, post, false);
  }

  campaign.lastPushAt = now;
  campaign.updatedAt = now;
  campaign.status = resolveCampaignStatusFromPosts(campaign);

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "platform_push",
    entityType: "campaign",
    entityId: campaign.id,
    message: `${campaign.campaignName} pushed live.`,
    metadata: { selectedPlatforms: campaign.selectedPlatforms },
  });

  await writeSocialOsState(state);
}

export async function retryPlatformPush(
  clientId: string,
  viewer: SocialViewer,
  campaignId: string,
  platform: SocialPlatform,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  const campaign = workspace.campaigns.find((item) => item.id === campaignId);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const post = campaign.posts.find((item) => item.platform === platform);
  if (!post) {
    throw new Error("Platform post not found.");
  }

  attemptPlatformPush(state, clientId, workspace.integrations, campaign, post, true);
  campaign.updatedAt = new Date().toISOString();
  campaign.status = resolveCampaignStatusFromPosts(campaign);

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "platform_push",
    entityType: "platform_post",
    entityId: post.id,
    message: `${post.platformLabel} retry triggered.`,
    metadata: { platform },
  });

  await writeSocialOsState(state);
}

export async function saveBrandVoice(
  clientId: string,
  viewer: SocialViewer,
  input: SaveBrandVoiceInput,
): Promise<void> {
  const state = await readSocialOsState();
  authorizeClientAccess(clientId, viewer);

  const client = mustFindClient(state, clientId);
  const workspace = ensureWorkspace(state, client);
  workspace.brandVoice = {
    ...workspace.brandVoice,
    tone: input.tone.trim(),
    hashtagStyle: input.hashtagStyle.trim(),
    ctaStyle: input.ctaStyle.trim(),
    emojiLevel: input.emojiLevel.trim(),
    productDescriptionStyle: input.productDescriptionStyle.trim(),
    updatedAt: new Date().toISOString(),
  };

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "credential_update",
    entityType: "brand_voice",
    entityId: clientId,
    message: "Brand voice settings updated.",
    metadata: {},
  });

  await writeSocialOsState(state);
}

export async function createClient(viewer: SocialViewer, input: CreateClientInput): Promise<void> {
  if (!viewer.isAdmin) {
    throw new Error("Admin access required.");
  }

  const state = await readSocialOsState();
  const users = await listSocialAuthUsers();

  const name = input.name.trim();
  const slug = slugify(input.slug || input.name);
  const brandName = input.brandName.trim() || `${name} Social OS`;
  const username = input.username.trim().toLowerCase();
  const password = input.password;

  if (!name || !slug || !username || password.length < 8) {
    throw new Error("Client name, slug, username, and an 8+ character password are required.");
  }

  if (state.clients.some((client) => client.slug === slug)) {
    throw new Error("That client slug already exists.");
  }

  if (users.some((user) => matchesUsername(user, username))) {
    throw new Error("That workspace username already exists.");
  }

  const clientId = crypto.randomUUID();
  const now = new Date().toISOString();
  const client: SocialClientRecord = {
    id: clientId,
    name,
    slug,
    brandName,
    workspaceTitle: `${name} Workspace`,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
  };

  state.clients.push(client);
  state.workspaces[client.id] = createDefaultWorkspace(client.id, now);
  await provisionClientLogin(client, username, password);

  appendAuditLog(state, {
    clientId: client.id,
    actorUsername: viewer.username,
    eventType: "credential_update",
    entityType: "client",
    entityId: client.id,
    message: `${client.name} workspace created.`,
    metadata: { username },
  });

  await writeSocialOsState(state);
}

export async function createClientLogin(
  viewer: SocialViewer,
  clientId: string,
  username: string,
  password: string,
): Promise<void> {
  if (!viewer.isAdmin) {
    throw new Error("Admin access required.");
  }

  const state = await readSocialOsState();
  const users = await listSocialAuthUsers();
  const client = mustFindClient(state, clientId);
  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername || password.trim().length < 8) {
    throw new Error("Username and an 8+ character password are required.");
  }

  if (users.some((user) => matchesUsername(user, normalizedUsername))) {
    throw new Error("That workspace username already exists.");
  }

  await provisionClientLogin(client, normalizedUsername, password);

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "credential_update",
    entityType: "auth_user",
    entityId: clientId,
    message: `${client.name} login created.`,
    metadata: { username: normalizedUsername },
  });

  await writeSocialOsState(state);
}

export async function resetClientPassword(
  viewer: SocialViewer,
  userId: string,
  newPassword: string,
): Promise<void> {
  if (!viewer.isAdmin) {
    throw new Error("Admin access required.");
  }

  if (newPassword.trim().length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const users = await listSocialAuthUsers();
  const target = users.find((user) => user.id === userId);
  if (!target) {
    throw new Error("Client user not found.");
  }

  const admin = createAdminSupabaseAuthClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) {
    throw new Error(error.message);
  }

  const state = await readSocialOsState();
  appendAuditLog(state, {
    clientId: getMetaText(target.user_metadata, "social_os_client_id") ?? null,
    actorUsername: viewer.username,
    eventType: "password_change",
    entityType: "auth_user",
    entityId: userId,
    message: `Password reset for ${getMetaText(target.user_metadata, "social_os_username") ?? target.email ?? userId}.`,
    metadata: {},
  });

  await writeSocialOsState(state);
}

export async function setClientAccess(
  viewer: SocialViewer,
  clientId: string,
  disabled: boolean,
): Promise<void> {
  if (!viewer.isAdmin) {
    throw new Error("Admin access required.");
  }

  const state = await readSocialOsState();
  const client = mustFindClient(state, clientId);
  client.disabledAt = disabled ? new Date().toISOString() : null;
  client.updatedAt = new Date().toISOString();

  appendAuditLog(state, {
    clientId,
    actorUsername: viewer.username,
    eventType: "credential_update",
    entityType: "client",
    entityId: clientId,
    message: disabled ? `${client.name} access disabled.` : `${client.name} access restored.`,
    metadata: { disabled },
  });

  await writeSocialOsState(state);
}

export function getClientWorkspacePath(clientId: string, state?: SocialState): string {
  const targetState = state;
  if (targetState) {
    const client = targetState.clients.find((item) => item.id === clientId);
    return client ? `/social-os/client/${client.slug}` : "/social-os";
  }
  return "/social-os";
}

function getSupabaseStorageClient(): SupabaseClient {
  return createAdminSupabaseAuthClient();
}

async function ensureSocialOsBucket(supabase: SupabaseClient) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(`Unable to list storage buckets: ${error.message}`);
  }

  if (buckets.some((bucket) => bucket.name === SOCIAL_OS_BUCKET)) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(SOCIAL_OS_BUCKET, {
    public: false,
    fileSizeLimit: "250MB",
    allowedMimeTypes: [
      "application/json",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
    ],
  });

  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    throw new Error(`Unable to create Social OS storage bucket: ${createError.message}`);
  }
}

async function readSocialOsState(): Promise<SocialState> {
  const supabase = getSupabaseStorageClient();
  await ensureSocialOsBucket(supabase);

  const { data, error } = await supabase.storage.from(SOCIAL_OS_BUCKET).download(SOCIAL_OS_STATE_PATH);
  if (error) {
    const missing =
      error.message.toLowerCase().includes("not found") ||
      error.message.toLowerCase().includes("no such object");
    if (!missing) {
      throw new Error(`Unable to load Social OS state: ${error.message}`);
    }

    const seeded = createSeedState();
    await writeSocialOsState(seeded);
    return seeded;
  }

  const parsed = JSON.parse(await data.text()) as SocialState;
  const normalized = normalizeState(parsed);
  if (normalized.version !== STATE_VERSION) {
    normalized.version = STATE_VERSION;
    await writeSocialOsState(normalized);
  }
  return normalized;
}

async function writeSocialOsState(state: SocialState): Promise<void> {
  const supabase = getSupabaseStorageClient();
  await ensureSocialOsBucket(supabase);
  const payload = JSON.stringify(state, null, 2);
  const { error } = await supabase.storage.from(SOCIAL_OS_BUCKET).upload(SOCIAL_OS_STATE_PATH, payload, {
    upsert: true,
    contentType: "application/json",
  });

  if (error) {
    throw new Error(`Unable to save Social OS state: ${error.message}`);
  }
}

async function listSocialAuthUsers(): Promise<AuthUserWithMeta[]> {
  const users = await listAuthUsers();
  return users.map((user) => ({
    ...user,
    email: user.email ?? null,
    user_metadata: user.user_metadata ?? null,
  }));
}

async function buildViewerFromAuthUser(
  user: AuthUserWithMeta,
  state: SocialState,
  users: AuthUserWithMeta[],
): Promise<SocialViewer | null> {
  const userMeta = user.user_metadata ?? {};
  const adminBySystem =
    users[0]?.id === user.id || (await isAuthenticatedOperatorAdmin().catch(() => false));
  const roleMeta = getMetaText(userMeta, "social_os_role");
  const slugMeta = getMetaText(userMeta, "social_os_client_slug");
  const idMeta = getMetaText(userMeta, "social_os_client_id");
  const isAdmin = adminBySystem || roleMeta === "platform_admin";
  const client = idMeta
    ? state.clients.find((item) => item.id === idMeta)
    : slugMeta
      ? state.clients.find((item) => item.slug === slugMeta)
      : null;

  if (!isAdmin && !client) {
    return null;
  }

  return {
    userId: user.id,
    clientId: client?.id ?? null,
    username:
      getMetaText(userMeta, "social_os_username") ??
      getMetaText(userMeta, "full_name") ??
      user.email ??
      user.id,
    role: isAdmin
      ? "platform_admin"
      : roleMeta === "client_user"
        ? "client_user"
        : "client_admin",
    isAdmin,
  };
}

function createSeedState(): SocialState {
  const now = new Date().toISOString();
  const tylerId = crypto.randomUUID();
  const tylerClient: SocialClientRecord = {
    id: tylerId,
    name: "Tyler Nelson",
    slug: "tyler-nelson",
    brandName: "Tyler Nelson Social OS",
    workspaceTitle: "Tyler Nelson Workspace",
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    version: STATE_VERSION,
    clients: [tylerClient],
    workspaces: {
      [tylerClient.id]: createDefaultWorkspace(tylerClient.id, now),
    },
    auditLogs: [],
  };
}

function normalizeState(state: SocialState): SocialState {
  const nextState: SocialState = {
    version: typeof state.version === "number" ? state.version : STATE_VERSION,
    clients: Array.isArray(state.clients) ? state.clients : [],
    workspaces: state.workspaces ?? {},
    auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs : [],
  };

  for (const client of nextState.clients) {
    nextState.workspaces[client.id] = ensureWorkspace(nextState, client);
  }

  return nextState;
}

function ensureWorkspace(state: SocialState, client: SocialClientRecord): SocialWorkspaceState {
  const existing = state.workspaces[client.id];
  if (existing) {
    existing.integrations = existing.integrations ?? createDefaultIntegrations(client.id);
    existing.mediaLibrary = existing.mediaLibrary ?? [];
    existing.brandVoice = existing.brandVoice ?? createDefaultBrandVoice(client.id, new Date().toISOString());
    existing.campaigns = existing.campaigns ?? [];
    return existing;
  }

  const workspace = createDefaultWorkspace(client.id, client.createdAt);
  state.workspaces[client.id] = workspace;
  return workspace;
}

function createDefaultWorkspace(clientId: string, now: string): SocialWorkspaceState {
  return {
    integrations: createDefaultIntegrations(clientId),
    mediaLibrary: [],
    brandVoice: createDefaultBrandVoice(clientId, now),
    campaigns: [],
  };
}

function createDefaultIntegrations(clientId: string): SocialStoredIntegration[] {
  const now = new Date().toISOString();
  return (Object.keys(PLATFORM_LABELS) as SocialPlatform[]).map((platform) => ({
    id: crypto.randomUUID(),
    clientId,
    platform,
    platformLabel: PLATFORM_LABELS[platform],
    maskedApiKey: null,
    maskedCliCommand: null,
    maskedWebhookUrl: null,
    encryptedApiKey: null,
    encryptedCliCommand: null,
    encryptedWebhookUrl: null,
    connectionStatus: "not connected",
    lastSuccessfulPush: null,
    lastFailedPush: null,
    lastError: null,
    lastTestedAt: null,
    updatedAt: now,
  }));
}

function createDefaultBrandVoice(clientId: string, now: string): SocialBrandVoiceSettings {
  return {
    clientId,
    tone: "Confident, direct, premium-social",
    hashtagStyle: "Use 3 to 5 focused branded hashtags.",
    ctaStyle: "One direct CTA with clear action.",
    emojiLevel: "Low to medium",
    productDescriptionStyle: "Benefit-first with one crisp proof point.",
    updatedAt: now,
  };
}

function buildOnboardingChecklist(input: {
  clientId: string;
  integrations: SocialStoredIntegration[];
  mediaLibrary: SocialMediaAssetRecord[];
  campaigns: SocialCampaignRecord[];
  clientUsers: AuthUserWithMeta[];
}): SocialOnboardingChecklistItem[] {
  const hasPostedCampaign = input.campaigns.some((campaign) =>
    campaign.posts.some((post) => post.status === "posted"),
  );
  const isConnected = (platform: SocialPlatform) =>
    input.integrations.some(
      (integration) =>
        integration.platform === platform && integration.connectionStatus === "connected",
    );

  const completeMap: Record<string, boolean> = {
    "login-created": input.clientUsers.length > 0,
    "tiktok-connected": isConnected("tiktok"),
    "tiktok-shop-connected": isConnected("tiktok-shop"),
    "instagram-connected": isConnected("instagram"),
    "facebook-connected": isConnected("facebook"),
    "x-connected": isConnected("x"),
    "first-reel-uploaded": input.mediaLibrary.length > 0,
    "first-campaign-pushed": hasPostedCampaign,
  };

  return ONBOARDING_ITEMS.map((item) => ({
    ...item,
    complete: completeMap[item.key] ?? false,
  }));
}

function hydrateCampaign(
  campaign: SocialCampaignRecord,
  mediaLibrary: SocialMediaAssetRecord[],
): SocialCampaignRecord {
  const assetName = mediaLibrary.find((asset) => asset.id === campaign.videoAssetId)?.originalName ?? null;
  return { ...campaign, videoAssetName: assetName };
}

function toPublicIntegration(integration: SocialStoredIntegration): SocialIntegrationRecord {
  return {
    id: integration.id,
    clientId: integration.clientId,
    platform: integration.platform,
    platformLabel: integration.platformLabel,
    maskedApiKey: integration.maskedApiKey,
    maskedCliCommand: integration.maskedCliCommand,
    maskedWebhookUrl: integration.maskedWebhookUrl,
    connectionStatus: integration.connectionStatus,
    lastSuccessfulPush: integration.lastSuccessfulPush,
    lastFailedPush: integration.lastFailedPush,
    lastError: integration.lastError,
    lastTestedAt: integration.lastTestedAt,
    updatedAt: integration.updatedAt,
  };
}

function determineSavedIntegrationStatus(integration: SocialStoredIntegration): SocialConnectionStatus {
  if (!integration.maskedApiKey && !integration.maskedCliCommand && !integration.maskedWebhookUrl) {
    return "not connected";
  }
  return integration.connectionStatus === "connected" ? "connected" : "needs reconnect";
}

function normalizeCampaignInput(input: SaveCampaignInput) {
  const selectedPlatforms = [...new Set(input.selectedPlatforms)].filter(
    (platform): platform is SocialPlatform => Boolean(PLATFORM_LABELS[platform]),
  );

  const campaignName = input.campaignName.trim();
  if (!campaignName) {
    throw new Error("Campaign name is required.");
  }

  return {
    id: input.id,
    campaignName,
    templateKey: input.templateKey.trim() || "product-demo",
    productName: input.productName.trim(),
    mainCaption: input.mainCaption.trim(),
    cta: input.cta.trim(),
    hashtags: normalizeTags(input.hashtags),
    productLink: input.productLink.trim(),
    shopLink: input.shopLink.trim(),
    selectedPlatforms,
    scheduledFor: input.scheduledFor?.trim() ? input.scheduledFor : null,
    videoAssetId: input.videoAssetId ?? null,
    platformOverrides: input.platformOverrides ?? {},
  };
}

function syncPlatformPosts(
  posts: SocialPlatformPostRecord[],
  campaignId: string,
  input: ReturnType<typeof normalizeCampaignInput>,
): SocialPlatformPostRecord[] {
  const now = new Date().toISOString();
  const nextPosts = [...posts];
  const selected = new Set(input.selectedPlatforms);

  for (const platform of input.selectedPlatforms) {
    const override = input.platformOverrides[platform];
    const existing = nextPosts.find((post) => post.platform === platform);
    const platformCaption =
      override?.caption?.trim() || generatePlatformCaption(input.mainCaption, platform);
    const platformHashtags = normalizeTags(override?.hashtags ?? input.hashtags);
    const platformCta = override?.cta?.trim() || generatePlatformCta(input.cta, platform);
    const productLink = override?.productLink?.trim() || input.productLink;
    const shopLink = override?.shopLink?.trim() || input.shopLink;
    const status = input.scheduledFor
      ? "scheduled"
      : input.videoAssetId && input.mainCaption && input.productLink
        ? "ready"
        : "draft";

    if (existing) {
      existing.platformCaption = platformCaption;
      existing.platformHashtags = platformHashtags;
      existing.platformCta = platformCta;
      existing.productLink = productLink;
      existing.shopLink = shopLink;
      existing.status = existing.postedAt ? existing.status : status;
      existing.errorMessage = null;
      existing.updatedAt = now;
    } else {
      nextPosts.push({
        id: crypto.randomUUID(),
        campaignId,
        platform,
        platformLabel: PLATFORM_LABELS[platform],
        platformCaption,
        platformHashtags,
        platformCta,
        productLink,
        shopLink,
        status,
        errorMessage: null,
        responseLog: null,
        previewTitle: `${PLATFORM_LABELS[platform]} Preview`,
        lastAttemptAt: null,
        postedAt: null,
        retryCount: 0,
        updatedAt: now,
      });
    }
  }

  return nextPosts.filter((post) => selected.has(post.platform));
}

function determineCampaignStatus(campaign: Pick<SocialCampaignRecord, "scheduledFor" | "videoAssetId" | "selectedPlatforms" | "mainCaption" | "cta" | "productLink">) {
  if (campaign.scheduledFor) {
    return "scheduled";
  }
  if (!campaign.videoAssetId || campaign.selectedPlatforms.length === 0) {
    return "draft";
  }
  if (!campaign.mainCaption || !campaign.cta || !campaign.productLink) {
    return "needs review";
  }
  return "ready";
}

function resolveCampaignStatusFromPosts(campaign: SocialCampaignRecord): SocialCampaignStatus {
  const activePosts = campaign.posts.filter((post) => campaign.selectedPlatforms.includes(post.platform));
  if (!activePosts.length) {
    return "draft";
  }
  if (activePosts.every((post) => post.status === "posted")) {
    return "posted";
  }
  if (activePosts.some((post) => post.status === "failed")) {
    return "failed";
  }
  if (activePosts.some((post) => post.status === "posting")) {
    return "posting";
  }
  return determineCampaignStatus(campaign);
}

function attemptPlatformPush(
  state: SocialState,
  clientId: string,
  integrations: SocialStoredIntegration[],
  campaign: SocialCampaignRecord,
  post: SocialPlatformPostRecord,
  isRetry: boolean,
) {
  const integration = integrations.find((item) => item.platform === post.platform);
  const now = new Date().toISOString();
  let status: SocialPostStatus = "posted";
  let errorMessage: string | null = null;
  const responseLog = `${now}: ${post.platformLabel} push accepted by mock transport.`;

  if (!campaign.videoAssetId) {
    status = "failed";
    errorMessage = "Video file must be approved before posting.";
  } else if (!post.platformCaption.trim()) {
    status = "failed";
    errorMessage = "Caption missing for this platform.";
  } else if (!integration || integration.connectionStatus !== "connected") {
    status = "failed";
    errorMessage = buildIntegrationFailure(integration?.connectionStatus ?? "not connected");
  } else if (
    post.platform === "x" &&
    `${post.platformCaption} ${post.platformHashtags.join(" ")}`.length > 280
  ) {
    status = "failed";
    errorMessage = "X preview is too long. Shorten the caption or hashtags.";
  }

  post.status = status;
  post.errorMessage = errorMessage;
  post.responseLog = status === "failed" ? `${now}: ${errorMessage}` : responseLog;
  post.lastAttemptAt = now;
  post.updatedAt = now;
  post.retryCount += isRetry ? 1 : 0;
  post.postedAt = status === "posted" ? now : post.postedAt;

  if (integration) {
    integration.updatedAt = now;
    if (status === "posted") {
      integration.lastSuccessfulPush = now;
      integration.lastError = null;
    } else {
      integration.lastFailedPush = now;
      integration.lastError = errorMessage;
    }
  }

  appendAuditLog(state, {
    clientId,
    actorUsername: "system",
    eventType: status === "posted" ? "platform_push" : "failed_push",
    entityType: "platform_post",
    entityId: post.id,
    message:
      status === "posted"
        ? `${post.platformLabel} push completed.`
        : `${post.platformLabel} push failed.`,
    metadata: {
      campaignId: campaign.id,
      platform: post.platform,
      errorMessage,
    },
  });
}

function validateReviewChecklist(review: PushReviewInput) {
  if (!Object.values(review).every(Boolean)) {
    throw new Error("All review confirmations are required before pushing live.");
  }
}

function buildIntegrationFailure(status: SocialConnectionStatus): string {
  switch (status) {
    case "token expired":
      return "Token expired. Reconnect before retrying.";
    case "needs reconnect":
      return "Connection needs reconnect before posting.";
    case "connected":
      return "Platform rejected the request.";
    case "not connected":
    default:
      return "Platform not connected yet.";
  }
}

function pickBrandVoiceSnapshot(brandVoice: SocialBrandVoiceSettings) {
  return {
    tone: brandVoice.tone,
    hashtagStyle: brandVoice.hashtagStyle,
    ctaStyle: brandVoice.ctaStyle,
    emojiLevel: brandVoice.emojiLevel,
    productDescriptionStyle: brandVoice.productDescriptionStyle,
  };
}

function appendAuditLog(
  state: SocialState,
  input: Omit<SocialAuditLogRecord, "id" | "createdAt">,
) {
  state.auditLogs.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  });
  state.auditLogs = state.auditLogs.slice(0, 300);
}

async function recordAuditLog(input: Omit<SocialAuditLogRecord, "id" | "createdAt">) {
  const state = await readSocialOsState();
  appendAuditLog(state, input);
  await writeSocialOsState(state);
}

function mapAuthUserToClientUser(
  user: AuthUserWithMeta,
  clientDisabledAt: string | null,
): SocialClientUserRecord {
  return {
    id: user.id,
    username:
      getMetaText(user.user_metadata, "social_os_username") ??
      user.email ??
      user.id,
    email: user.email,
    role:
      getMetaText(user.user_metadata, "social_os_role") === "client_user"
        ? "client_user"
        : "client_admin",
    disabledAt: clientDisabledAt,
    lastLoginAt: user.last_sign_in_at ?? null,
  };
}

function matchesUsername(user: AuthUserWithMeta, username: string) {
  return (
    getMetaText(user.user_metadata, "social_os_username")?.toLowerCase() === username ||
    user.email?.toLowerCase() === username
  );
}

function getMetaText(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mustFindClient(state: SocialState, clientId: string) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) {
    throw new Error("Client workspace not found.");
  }
  return client;
}

function authorizeClientAccess(clientId: string, viewer: SocialViewer) {
  if (!viewer.isAdmin && viewer.clientId !== clientId) {
    throw new Error("You do not have access to this client workspace.");
  }
}

function getLatestDate(values: Array<string | null>) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function normalizeTags(tags: string[] | undefined) {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function generatePlatformCaption(mainCaption: string, platform: SocialPlatform) {
  if (platform === "x") {
    return mainCaption.length > 220 ? `${mainCaption.slice(0, 217)}...` : mainCaption;
  }
  if (platform === "tiktok-shop") {
    return `${mainCaption} Shop the featured product directly from this post.`;
  }
  if (platform === "facebook") {
    return `${mainCaption} Watch the full reel and tap through for details.`;
  }
  return mainCaption;
}

function generatePlatformCta(cta: string, platform: SocialPlatform) {
  if (platform === "tiktok-shop") return cta || "Tap the shop link to grab yours.";
  if (platform === "x") return cta || "Watch now.";
  return cta || "Tap in now.";
}

function buildWorkspaceEmail(slug: string, username: string) {
  return `${slug}.${username}@socialos.blackspirehelix.local`;
}

async function provisionClientLogin(
  client: SocialClientRecord,
  username: string,
  password: string,
) {
  const admin = createAdminSupabaseAuthClient();
  const email = buildWorkspaceEmail(client.slug, username);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: client.name,
      social_os_username: username,
      social_os_client_slug: client.slug,
      social_os_client_id: client.id,
      social_os_role: "client_admin",
      social_os_brand_name: client.brandName,
      access_source: "social_os_workspace",
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Unable to create the client login.");
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function daysSince(value: string) {
  return Math.floor((Date.now() - Date.parse(value)) / (1000 * 60 * 60 * 24));
}

function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptSecret(payload: string) {
  const [ivRaw, tagRaw, dataRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !dataRaw) {
    return "";
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivRaw, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function getEncryptionKey() {
  const seed =
    process.env.BLACKSPIRE_SOCIAL_OS_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "blackspire-social-os";
  return crypto.createHash("sha256").update(seed).digest();
}

function maskSecret(value: string) {
  if (value.length <= 8) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function maskCommand(value: string) {
  const trimmed = value.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return `${trimmed.slice(0, 4)}****`;
  }
  return `${trimmed.slice(0, firstSpace)} ****`;
}

function maskUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}/****`;
  } catch {
    return "****";
  }
}
