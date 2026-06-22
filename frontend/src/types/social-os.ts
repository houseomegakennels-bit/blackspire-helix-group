export const socialPlatforms = [
  "tiktok",
  "tiktok-shop",
  "instagram",
  "facebook",
  "x",
] as const;

export type SocialPlatform = (typeof socialPlatforms)[number];

export type SocialConnectionStatus =
  | "connected"
  | "not connected"
  | "token expired"
  | "needs reconnect";

export type SocialCredentialAssistStatus =
  | "none"
  | "requested"
  | "in_review"
  | "awaiting_client"
  | "completed";

export type SocialCampaignStatus =
  | "draft"
  | "ready"
  | "posting"
  | "posted"
  | "failed"
  | "needs review"
  | "scheduled";

export type SocialPostStatus =
  | "draft"
  | "ready"
  | "posting"
  | "posted"
  | "failed"
  | "scheduled";

export type SocialUserRole = "client_user" | "client_admin" | "platform_admin";

export interface SocialClientRecord {
  id: string;
  name: string;
  slug: string;
  brandName: string;
  workspaceTitle: string;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialViewer {
  userId: string;
  clientId: string | null;
  username: string;
  role: SocialUserRole;
  isAdmin: boolean;
}

export interface SocialCredentialAssistRecord {
  clientId: string;
  platform: SocialPlatform;
  status: SocialCredentialAssistStatus;
  requestedBy: string | null;
  preferredContact: string;
  requestNote: string;
  supportNote: string;
  requestedAt: string | null;
  updatedAt: string;
  handledBy: string | null;
  handledAt: string | null;
}

export interface SocialIntegrationRecord {
  id: string;
  clientId: string;
  platform: SocialPlatform;
  platformLabel: string;
  maskedApiKey: string | null;
  maskedCliCommand: string | null;
  maskedWebhookUrl: string | null;
  connectionStatus: SocialConnectionStatus;
  lastSuccessfulPush: string | null;
  lastFailedPush: string | null;
  lastError: string | null;
  lastTestedAt: string | null;
  updatedAt: string;
  credentialAssist: SocialCredentialAssistRecord;
}

export interface SocialMediaAssetRecord {
  id: string;
  clientId: string;
  fileName: string;
  originalName: string;
  storedPath: string;
  mimeType: string;
  fileSize: number;
  durationLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialBrandVoiceSettings {
  clientId: string;
  tone: string;
  hashtagStyle: string;
  ctaStyle: string;
  emojiLevel: string;
  productDescriptionStyle: string;
  updatedAt: string;
}

export interface SocialCampaignTemplate {
  key: string;
  name: string;
  description: string;
  defaultCaptionPrompt: string;
  defaultCta: string;
}

export interface SocialPlatformPostRecord {
  id: string;
  campaignId: string;
  platform: SocialPlatform;
  platformLabel: string;
  platformCaption: string;
  platformHashtags: string[];
  platformCta: string;
  productLink: string;
  shopLink: string;
  status: SocialPostStatus;
  errorMessage: string | null;
  responseLog: string | null;
  previewTitle: string;
  lastAttemptAt: string | null;
  postedAt: string | null;
  retryCount: number;
  updatedAt: string;
}

export interface SocialCampaignRecord {
  id: string;
  clientId: string;
  campaignName: string;
  templateKey: string;
  productName: string;
  mainCaption: string;
  cta: string;
  hashtags: string[];
  productLink: string;
  shopLink: string;
  selectedPlatforms: SocialPlatform[];
  status: SocialCampaignStatus;
  scheduledFor: string | null;
  videoAssetId: string | null;
  videoAssetName: string | null;
  brandVoiceSnapshot: Pick<
    SocialBrandVoiceSettings,
    "tone" | "hashtagStyle" | "ctaStyle" | "emojiLevel" | "productDescriptionStyle"
  >;
  createdAt: string;
  updatedAt: string;
  lastPushAt: string | null;
  posts: SocialPlatformPostRecord[];
}

export interface SocialAuditLogRecord {
  id: string;
  clientId: string | null;
  actorUsername: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SocialOnboardingChecklistItem {
  key: string;
  label: string;
  complete: boolean;
}

export interface SocialClientUserRecord {
  id: string;
  username: string;
  email: string | null;
  role: SocialUserRole;
  disabledAt: string | null;
  lastLoginAt: string | null;
}

export interface SocialWorkspaceSnapshot {
  client: SocialClientRecord;
  viewer: SocialViewer;
  tabs: Array<{
    id: "dashboard" | "upload" | "campaigns" | "media-library" | "integrations" | "logs" | "settings";
    label: string;
  }>;
  templates: SocialCampaignTemplate[];
  onboardingChecklist: SocialOnboardingChecklistItem[];
  integrations: SocialIntegrationRecord[];
  connectionHealth: {
    connected: number;
    attentionNeeded: number;
    lastSuccessfulPush: string | null;
    lastFailedPush: string | null;
  };
  campaigns: SocialCampaignRecord[];
  mediaLibrary: SocialMediaAssetRecord[];
  brandVoice: SocialBrandVoiceSettings;
  auditLogs: SocialAuditLogRecord[];
  dashboard: {
    activeCampaigns: number;
    draftCampaigns: number;
    postedCampaigns: number;
    failedPushes: number;
    recentUploads: number;
  };
}

export interface SocialAdminSnapshot {
  viewer: SocialViewer;
  clients: Array<
    SocialClientRecord & {
      users: SocialClientUserRecord[];
      integrations: SocialIntegrationRecord[];
      pendingCredentialRequests: number;
      failedPushes: Array<{
        campaignName: string;
        platformLabel: string;
        errorMessage: string;
        updatedAt: string;
      }>;
    }
  >;
  auditLogs: SocialAuditLogRecord[];
}
