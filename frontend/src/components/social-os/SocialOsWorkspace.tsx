"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  SocialCampaignRecord,
  SocialPlatform,
  SocialWorkspaceSnapshot
} from "@/types/social-os";

type WorkspaceTab = SocialWorkspaceSnapshot["tabs"][number]["id"];

type ModalState =
  | null
  | { type: "delete-campaign"; campaignId: string; campaignName: string }
  | { type: "remove-integration"; platform: SocialPlatform; platformLabel: string }
  | { type: "logout" }
  | {
      type: "review-push";
      campaignId: string;
      campaignName: string;
      review: {
        platformsSelected: boolean;
        captionApproved: boolean;
        ctaApproved: boolean;
        productLinkApproved: boolean;
        videoFileApproved: boolean;
      };
    }
  | { type: "view-log"; title: string; body: string };

interface CampaignFormState {
  id?: string;
  campaignName: string;
  templateKey: string;
  productName: string;
  mainCaption: string;
  cta: string;
  hashtagsText: string;
  productLink: string;
  shopLink: string;
  selectedPlatforms: SocialPlatform[];
  scheduledFor: string;
  videoAssetId: string;
  platformOverrides: Record<
    SocialPlatform,
    {
      caption: string;
      hashtagsText: string;
      cta: string;
      productLink: string;
      shopLink: string;
    }
  >;
}

function createBlankOverrides() {
  return {
    tiktok: { caption: "", hashtagsText: "", cta: "", productLink: "", shopLink: "" },
    "tiktok-shop": { caption: "", hashtagsText: "", cta: "", productLink: "", shopLink: "" },
    instagram: { caption: "", hashtagsText: "", cta: "", productLink: "", shopLink: "" },
    facebook: { caption: "", hashtagsText: "", cta: "", productLink: "", shopLink: "" },
    x: { caption: "", hashtagsText: "", cta: "", productLink: "", shopLink: "" }
  };
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Not yet";
  }
  return new Date(value).toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function createBlankCampaign(workspace: SocialWorkspaceSnapshot): CampaignFormState {
  const defaultTemplate = workspace.templates[0];
  return {
    campaignName: "",
    templateKey: defaultTemplate?.key ?? "product-demo",
    productName: "",
    mainCaption: "",
    cta: defaultTemplate?.defaultCta ?? "",
    hashtagsText: "",
    productLink: "",
    shopLink: "",
    selectedPlatforms: ["tiktok", "instagram"],
    scheduledFor: "",
    videoAssetId: workspace.mediaLibrary[0]?.id ?? "",
    platformOverrides: createBlankOverrides()
  };
}

function campaignToForm(campaign: SocialCampaignRecord): CampaignFormState {
  const overrides = createBlankOverrides();
  for (const post of campaign.posts) {
    overrides[post.platform] = {
      caption: post.platformCaption,
      hashtagsText: post.platformHashtags.join(", "),
      cta: post.platformCta,
      productLink: post.productLink,
      shopLink: post.shopLink
    };
  }

  return {
    id: campaign.id,
    campaignName: campaign.campaignName,
    templateKey: campaign.templateKey,
    productName: campaign.productName,
    mainCaption: campaign.mainCaption,
    cta: campaign.cta,
    hashtagsText: campaign.hashtags.join(", "),
    productLink: campaign.productLink,
    shopLink: campaign.shopLink,
    selectedPlatforms: campaign.selectedPlatforms,
    scheduledFor: campaign.scheduledFor
      ? new Date(campaign.scheduledFor).toISOString().slice(0, 16)
      : "",
    videoAssetId: campaign.videoAssetId ?? "",
    platformOverrides: overrides
  };
}

export function SocialOsWorkspace({
  initialWorkspace
}: {
  initialWorkspace: SocialWorkspaceSnapshot;
}) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    initialWorkspace.campaigns[0]?.id ?? null
  );
  const [campaignForm, setCampaignForm] = useState<CampaignFormState>(
    initialWorkspace.campaigns[0]
      ? campaignToForm(initialWorkspace.campaigns[0])
      : createBlankCampaign(initialWorkspace)
  );
  const [selectedPlatformEditor, setSelectedPlatformEditor] = useState<SocialPlatform>("tiktok");
  const [integrationDrafts, setIntegrationDrafts] = useState<
    Record<SocialPlatform, { apiKey: string; cliCommand: string; webhookUrl: string }>
  >({
    tiktok: { apiKey: "", cliCommand: "", webhookUrl: "" },
    "tiktok-shop": { apiKey: "", cliCommand: "", webhookUrl: "" },
    instagram: { apiKey: "", cliCommand: "", webhookUrl: "" },
    facebook: { apiKey: "", cliCommand: "", webhookUrl: "" },
    x: { apiKey: "", cliCommand: "", webhookUrl: "" }
  });
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [isPending, startTransition] = useTransition();

  const selectedCampaign = useMemo(
    () => workspace.campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [selectedCampaignId, workspace.campaigns]
  );

  const handleWorkspaceRefresh = (nextWorkspace: SocialWorkspaceSnapshot) => {
    startTransition(() => {
      setWorkspace(nextWorkspace);
      setIntegrationDrafts({
        tiktok: { apiKey: "", cliCommand: "", webhookUrl: "" },
        "tiktok-shop": { apiKey: "", cliCommand: "", webhookUrl: "" },
        instagram: { apiKey: "", cliCommand: "", webhookUrl: "" },
        facebook: { apiKey: "", cliCommand: "", webhookUrl: "" },
        x: { apiKey: "", cliCommand: "", webhookUrl: "" }
      });

      if (!nextWorkspace.campaigns.length) {
        setSelectedCampaignId(null);
        setCampaignForm(createBlankCampaign(nextWorkspace));
        return;
      }

      const activeCampaign =
        nextWorkspace.campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
        nextWorkspace.campaigns[0];
      setSelectedCampaignId(activeCampaign.id);
      setCampaignForm(campaignToForm(activeCampaign));
    });
  };

  const callWorkspaceAction = async (
    action: string,
    payload: Record<string, unknown>,
    busyText: string,
    successMessage?: string
  ) => {
    setBusyLabel(busyText);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/social-os/workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clientSlug: workspace.client.slug,
          action,
          payload
        })
      });
      const data = (await response.json()) as {
        error?: string;
        workspace?: SocialWorkspaceSnapshot;
      };

      if (!response.ok || !data.workspace) {
        throw new Error(data.error ?? "Workspace update failed.");
      }

      handleWorkspaceRefresh(data.workspace);
      if (successMessage) {
        setNotice(successMessage);
      }
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : "Workspace update failed.";
      setError(message);
    } finally {
      setBusyLabel(null);
    }
  };

  const handleSaveCampaign = async () => {
    await callWorkspaceAction(
      "save-campaign",
      {
        id: campaignForm.id,
        campaignName: campaignForm.campaignName,
        templateKey: campaignForm.templateKey,
        productName: campaignForm.productName,
        mainCaption: campaignForm.mainCaption,
        cta: campaignForm.cta,
        hashtags: parseTags(campaignForm.hashtagsText),
        productLink: campaignForm.productLink,
        shopLink: campaignForm.shopLink,
        selectedPlatforms: campaignForm.selectedPlatforms,
        scheduledFor: campaignForm.scheduledFor
          ? new Date(campaignForm.scheduledFor).toISOString()
          : null,
        videoAssetId: campaignForm.videoAssetId || null,
        platformOverrides: Object.fromEntries(
          Object.entries(campaignForm.platformOverrides).map(([platform, value]) => [
            platform,
            {
              caption: value.caption,
              hashtags: parseTags(value.hashtagsText),
              cta: value.cta,
              productLink: value.productLink,
              shopLink: value.shopLink
            }
          ])
        )
      },
      campaignForm.id ? "Saving campaign..." : "Generating platform versions...",
      campaignForm.id ? "Campaign updated." : "Campaign created and platform versions generated."
    );
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusyLabel("Uploading reel...");
    setNotice(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("clientSlug", workspace.client.slug);
      formData.append("file", file);

      const response = await fetch("/api/social-os/media", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as {
        error?: string;
        workspace?: SocialWorkspaceSnapshot;
      };

      if (!response.ok || !data.workspace) {
        throw new Error(data.error ?? "Upload failed.");
      }

      handleWorkspaceRefresh(data.workspace);
      setNotice("Reel uploaded to the reusable media library.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setBusyLabel(null);
      event.target.value = "";
    }
  };

  const handleLogout = async () => {
    setBusyLabel("Logging out...");
    setError(null);
    setNotice(null);
    try {
      await fetch("/api/social-os/logout", {
        method: "POST"
      });
      router.push("/social-os/login");
      router.refresh();
    } finally {
      setBusyLabel(null);
      setModal(null);
    }
  };

  const highlightedFailedPosts = workspace.campaigns.flatMap((campaign) =>
    campaign.posts
      .filter((post) => post.status === "failed")
      .map((post) => ({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        post
      }))
  );

  const applyTemplate = (templateKey: string) => {
    const template = workspace.templates.find((item) => item.key === templateKey);
    setCampaignForm((current) => ({
      ...current,
      templateKey,
      cta: current.cta || template?.defaultCta || "",
      mainCaption: current.mainCaption || template?.defaultCaptionPrompt || ""
    }));
  };

  const selectCampaign = (campaign: SocialCampaignRecord) => {
    setSelectedCampaignId(campaign.id);
    setCampaignForm(campaignToForm(campaign));
    setActiveTab("campaigns");
    setSelectedPlatformEditor(campaign.selectedPlatforms[0] ?? "tiktok");
  };

  const selectedPlatformOverride = campaignForm.platformOverrides[selectedPlatformEditor];

  return (
    <main className="social-os-shell">
      <div className="backdrop-grid" />
      <section className="social-os-hero panel">
        <div>
          <span className="eyebrow">BLACKSPIRE HELIX SOCIAL OS</span>
          <p className="hero-kicker">{workspace.client.brandName}</p>
          <h1>{workspace.client.name} Workspace</h1>
          <p className="hero-copy">
            Upload once, customize per platform, review every surface, and push campaigns with
            safer retries, masked credentials, and client-ready controls.
          </p>
          <div className="hero-signal-row">
            <span className="hero-signal">Multi-client ready</span>
            <span className="hero-signal">Protected login gate</span>
            <span className="hero-signal">Post once, customize everywhere</span>
          </div>
        </div>
        <div className="social-os-hero-side">
          <div className="sync-meta">
            <span>Signed in as</span>
            <strong>{workspace.viewer.username}</strong>
            <span>{workspace.viewer.isAdmin ? "Blackspire admin mode enabled" : "Client workspace access"}</span>
          </div>
          <div className="social-os-hero-actions">
            {workspace.viewer.isAdmin ? (
              <a className="ghost-button" href="/social-os/admin">
                Open Admin Mode
              </a>
            ) : null}
            <button className="ghost-button" type="button" onClick={() => setModal({ type: "logout" })}>
              Logout
            </button>
          </div>
        </div>
      </section>

      <section className="social-os-tab-row panel">
        <div className="social-os-tab-strip">
          {workspace.tabs.map((tab) => (
            <button
              key={tab.id}
              className={`ghost-button ${activeTab === tab.id ? "ghost-button-active" : ""}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="social-os-status-strip">
          {busyLabel || isPending ? <span className="hero-signal">{busyLabel ?? "Refreshing workspace..."}</span> : null}
          {notice ? <span className="hero-signal social-os-success-pill">{notice}</span> : null}
          {error ? <span className="hero-signal social-os-danger-pill">{error}</span> : null}
        </div>
      </section>

      {activeTab === "dashboard" ? (
        <section className="social-os-grid">
          <div className="social-os-main-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Onboarding</span>
                  <h2>Guided checklist</h2>
                </div>
                <span>
                  {workspace.onboardingChecklist.filter((item) => item.complete).length}/
                  {workspace.onboardingChecklist.length} complete
                </span>
              </div>
              <div className="social-os-checklist-grid">
                {workspace.onboardingChecklist.map((item) => (
                  <div
                    key={item.key}
                    className={`social-os-checklist-card ${item.complete ? "social-os-complete" : ""}`}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.complete ? "Complete" : "Next step"}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Connection Health</span>
                  <h2>Platform status</h2>
                </div>
                <span>{workspace.connectionHealth.connected} connected</span>
              </div>
              <div className="social-os-health-list">
                {workspace.integrations.map((integration) => (
                  <div key={integration.id} className="social-os-health-item">
                    <div>
                      <strong>{integration.platformLabel}</strong>
                      <p>{integration.connectionStatus}</p>
                    </div>
                    <div className="social-os-health-meta">
                      <span>Last successful push: {formatDate(integration.lastSuccessfulPush)}</span>
                      <span>Last failed push: {formatDate(integration.lastFailedPush)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="social-os-side-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Workspace Snapshot</span>
                  <h2>Dashboard totals</h2>
                </div>
              </div>
              <div className="social-os-stats-grid">
                <div className="stat-card panel">
                  <span>Active campaigns</span>
                  <strong>{workspace.dashboard.activeCampaigns}</strong>
                </div>
                <div className="stat-card panel">
                  <span>Draft campaigns</span>
                  <strong>{workspace.dashboard.draftCampaigns}</strong>
                </div>
                <div className="stat-card panel">
                  <span>Posted campaigns</span>
                  <strong>{workspace.dashboard.postedCampaigns}</strong>
                </div>
                <div className="stat-card panel">
                  <span>Failed pushes</span>
                  <strong>{workspace.dashboard.failedPushes}</strong>
                </div>
              </div>
            </article>

            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>What to do next</span>
                  <h2>Fast start</h2>
                </div>
              </div>
              <div className="intel-list">
                <div className="intel-item">
                  <span className="intel-dot" />
                  <p>Upload the first reel in the Upload tab so it becomes reusable in the media library.</p>
                </div>
                <div className="intel-item">
                  <span className="intel-dot" />
                  <p>Test each integration to move platforms from “Not connected” into a healthy state.</p>
                </div>
                <div className="intel-item">
                  <span className="intel-dot" />
                  <p>Use a campaign template, customize per platform, then confirm every review requirement before pushing live.</p>
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "upload" ? (
        <section className="social-os-grid">
          <div className="social-os-main-column">
            <article className="panel social-os-card social-os-upload-card">
              <div className="panel-heading">
                <div>
                  <span>Upload</span>
                  <h2>Save once, reuse forever</h2>
                </div>
              </div>
              <label className="social-os-upload-dropzone">
                <input accept="video/*" type="file" onChange={handleUpload} />
                <strong>{busyLabel === "Uploading reel..." ? "Uploading reel..." : "Upload AI UGC reel"}</strong>
                <p>Every uploaded reel is saved into this client&apos;s media library for future campaigns.</p>
              </label>
            </article>
          </div>
          <div className="social-os-side-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Recent uploads</span>
                  <h2>Latest media</h2>
                </div>
              </div>
              {workspace.mediaLibrary.length ? (
                <div className="recent-campaigns-list">
                  {workspace.mediaLibrary.slice(0, 6).map((asset) => (
                    <div key={asset.id} className="asset-card">
                      <strong>{asset.originalName}</strong>
                      <span>{formatBytes(asset.fileSize)}</span>
                      <p>{asset.durationLabel}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  No reels have been uploaded yet. Add the first video here to unlock the reusable media library.
                </p>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "campaigns" ? (
        <section className="social-os-grid">
          <div className="social-os-main-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Campaign templates</span>
                  <h2>Choose a starting angle</h2>
                </div>
              </div>
              <div className="social-os-template-grid">
                {workspace.templates.map((template) => (
                  <button
                    key={template.key}
                    className={`link-selector-card ${
                      campaignForm.templateKey === template.key ? "link-selector-card-active" : ""
                    }`}
                    type="button"
                    onClick={() => applyTemplate(template.key)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Post once, customize everywhere</span>
                  <h2>Campaign editor</h2>
                </div>
                <div className="campaign-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setSelectedCampaignId(null);
                      setCampaignForm(createBlankCampaign(workspace));
                    }}
                  >
                    New campaign
                  </button>
                  {campaignForm.id ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        callWorkspaceAction(
                          "duplicate-campaign",
                          { campaignId: campaignForm.id },
                          "Duplicating campaign...",
                          "Campaign duplicated."
                        )
                      }
                    >
                      Duplicate
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="social-os-editor-layout">
                <div className="social-os-editor-main">
                  <div className="campaign-form social-os-campaign-form">
                    <label className="field">
                      <span>Campaign name</span>
                      <input
                        value={campaignForm.campaignName}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            campaignName: event.target.value
                          }))
                        }
                        placeholder="Summer drop demo reel"
                      />
                    </label>
                    <label className="field">
                      <span>Product / offer</span>
                      <input
                        value={campaignForm.productName}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            productName: event.target.value
                          }))
                        }
                        placeholder={`${workspace.client.name}'s featured product`}
                      />
                    </label>
                    <label className="field field-span-2">
                      <span>Main caption</span>
                      <textarea
                        value={campaignForm.mainCaption}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            mainCaption: event.target.value
                          }))
                        }
                        placeholder="Write the main campaign message once here."
                      />
                    </label>
                    <label className="field">
                      <span>CTA</span>
                      <input
                        value={campaignForm.cta}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            cta: event.target.value
                          }))
                        }
                        placeholder="Shop now"
                      />
                    </label>
                    <label className="field">
                      <span>Hashtags</span>
                      <input
                        value={campaignForm.hashtagsText}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            hashtagsText: event.target.value
                          }))
                        }
                        placeholder="#brandname, #ugcad, #newdrop"
                      />
                    </label>
                    <label className="field">
                      <span>Product link</span>
                      <input
                        value={campaignForm.productLink}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            productLink: event.target.value
                          }))
                        }
                        placeholder="https://..."
                      />
                    </label>
                    <label className="field">
                      <span>Shop link</span>
                      <input
                        value={campaignForm.shopLink}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            shopLink: event.target.value
                          }))
                        }
                        placeholder="https://shop..."
                      />
                    </label>
                    <label className="field">
                      <span>Video file</span>
                      <select
                        value={campaignForm.videoAssetId}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            videoAssetId: event.target.value
                          }))
                        }
                      >
                        <option value="">Select saved reel</option>
                        {workspace.mediaLibrary.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.originalName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Schedule post</span>
                      <input
                        type="datetime-local"
                        value={campaignForm.scheduledFor}
                        onChange={(event) =>
                          setCampaignForm((current) => ({
                            ...current,
                            scheduledFor: event.target.value
                          }))
                        }
                      />
                    </label>
                    <div className="field field-span-2">
                      <span>Platforms selected</span>
                      <div className="social-os-platform-grid">
                        {workspace.integrations.map((integration) => {
                          const selected = campaignForm.selectedPlatforms.includes(integration.platform);
                          return (
                            <button
                              key={integration.id}
                              className={`link-selector-card ${selected ? "link-selector-card-active" : ""}`}
                              type="button"
                              onClick={() =>
                                setCampaignForm((current) => ({
                                  ...current,
                                  selectedPlatforms: selected
                                    ? current.selectedPlatforms.filter((platform) => platform !== integration.platform)
                                    : [...current.selectedPlatforms, integration.platform]
                                }))
                              }
                            >
                              <strong>{integration.platformLabel}</strong>
                              <span>{integration.connectionStatus}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="social-os-editor-actions">
                    <button className="sync-button" type="button" onClick={handleSaveCampaign}>
                      {campaignForm.id ? "Save campaign" : "Generate platform versions"}
                    </button>
                    {campaignForm.id ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() =>
                          setModal({
                            type: "review-push",
                            campaignId: campaignForm.id as string,
                            campaignName: campaignForm.campaignName || "Untitled campaign",
                            review: {
                              platformsSelected: campaignForm.selectedPlatforms.length > 0,
                              captionApproved: Boolean(campaignForm.mainCaption.trim()),
                              ctaApproved: Boolean(campaignForm.cta.trim()),
                              productLinkApproved: Boolean(
                                (campaignForm.productLink || campaignForm.shopLink).trim()
                              ),
                              videoFileApproved: Boolean(campaignForm.videoAssetId)
                            }
                          })
                        }
                      >
                        Push campaign live
                      </button>
                    ) : null}
                    {campaignForm.id ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() =>
                          setModal({
                            type: "delete-campaign",
                            campaignId: campaignForm.id as string,
                            campaignName: campaignForm.campaignName
                          })
                        }
                      >
                        Delete campaign
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="social-os-editor-side">
                  <div className="panel social-os-nested-card">
                    <div className="panel-heading">
                      <div>
                        <span>Platform-specific edits</span>
                        <h3>Customize the right side</h3>
                      </div>
                    </div>
                    <div className="social-os-platform-tabs">
                      {(campaignForm.selectedPlatforms.length
                        ? campaignForm.selectedPlatforms
                        : (workspace.integrations.map((integration) => integration.platform) as SocialPlatform[])
                      ).map((platform) => (
                        <button
                          key={platform}
                          className={`ghost-button ${selectedPlatformEditor === platform ? "ghost-button-active" : ""}`}
                          type="button"
                          onClick={() => setSelectedPlatformEditor(platform)}
                        >
                          {workspace.integrations.find((integration) => integration.platform === platform)?.platformLabel}
                        </button>
                      ))}
                    </div>
                    <div className="prompt-editor-grid">
                      <label className="field field-span-2">
                        <span>Platform caption</span>
                        <textarea
                          value={selectedPlatformOverride.caption}
                          onChange={(event) =>
                            setCampaignForm((current) => ({
                              ...current,
                              platformOverrides: {
                                ...current.platformOverrides,
                                [selectedPlatformEditor]: {
                                  ...current.platformOverrides[selectedPlatformEditor],
                                  caption: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="Optional override for this platform"
                        />
                      </label>
                      <label className="field">
                        <span>Platform hashtags</span>
                        <input
                          value={selectedPlatformOverride.hashtagsText}
                          onChange={(event) =>
                            setCampaignForm((current) => ({
                              ...current,
                              platformOverrides: {
                                ...current.platformOverrides,
                                [selectedPlatformEditor]: {
                                  ...current.platformOverrides[selectedPlatformEditor],
                                  hashtagsText: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="#platform, #custom"
                        />
                      </label>
                      <label className="field">
                        <span>Platform CTA</span>
                        <input
                          value={selectedPlatformOverride.cta}
                          onChange={(event) =>
                            setCampaignForm((current) => ({
                              ...current,
                              platformOverrides: {
                                ...current.platformOverrides,
                                [selectedPlatformEditor]: {
                                  ...current.platformOverrides[selectedPlatformEditor],
                                  cta: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="Optional CTA override"
                        />
                      </label>
                      <label className="field">
                        <span>Product link override</span>
                        <input
                          value={selectedPlatformOverride.productLink}
                          onChange={(event) =>
                            setCampaignForm((current) => ({
                              ...current,
                              platformOverrides: {
                                ...current.platformOverrides,
                                [selectedPlatformEditor]: {
                                  ...current.platformOverrides[selectedPlatformEditor],
                                  productLink: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="Optional product URL override"
                        />
                      </label>
                      <label className="field">
                        <span>Shop link override</span>
                        <input
                          value={selectedPlatformOverride.shopLink}
                          onChange={(event) =>
                            setCampaignForm((current) => ({
                              ...current,
                              platformOverrides: {
                                ...current.platformOverrides,
                                [selectedPlatformEditor]: {
                                  ...current.platformOverrides[selectedPlatformEditor],
                                  shopLink: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="Optional shop URL override"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Preview cards</span>
                  <h2>Review every platform before posting</h2>
                </div>
              </div>
              {selectedCampaign?.posts.length ? (
                <div className="social-os-preview-grid">
                  {selectedCampaign.posts.map((post) => (
                    <div key={post.id} className="campaign-asset-preview-card">
                      <div className="campaign-asset-preview-copy">
                        <span>{post.previewTitle}</span>
                        <strong>{post.platformLabel}</strong>
                        <p>{post.platformCaption}</p>
                        <p>CTA: {post.platformCta || "None set"}</p>
                        <p>
                          Hashtags: {post.platformHashtags.length ? post.platformHashtags.join(", ") : "None set"}
                        </p>
                        <p>Status: {post.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  No platform previews yet. Save a campaign to generate editable TikTok, TikTok Shop, Instagram, Facebook, and X versions.
                </p>
              )}
            </article>
          </div>

          <div className="social-os-side-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Campaign history</span>
                  <h2>Recent campaigns</h2>
                </div>
              </div>
              {workspace.campaigns.length ? (
                <div className="recent-campaigns-list">
                  {workspace.campaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      className={`recent-campaign-card ${
                        selectedCampaignId === campaign.id ? "prompt-card-active" : ""
                      }`}
                      type="button"
                      onClick={() => selectCampaign(campaign)}
                    >
                      <strong>{campaign.campaignName}</strong>
                      <div className="recent-campaign-meta">
                        <span>{campaign.status}</span>
                        <span>{campaign.selectedPlatforms.length} platforms</span>
                      </div>
                      <p>{campaign.productName || "No product yet"}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  No campaigns exist yet. Start with a template, attach a reel, and save your first campaign draft.
                </p>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "media-library" ? (
        <section className="social-os-grid">
          <div className="social-os-main-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Reusable reels</span>
                  <h2>Media library</h2>
                </div>
              </div>
              {workspace.mediaLibrary.length ? (
                <div className="asset-grid">
                  {workspace.mediaLibrary.map((asset) => (
                    <button
                      key={asset.id}
                      className={`asset-card ${
                        campaignForm.videoAssetId === asset.id ? "asset-card-active" : ""
                      }`}
                      type="button"
                      onClick={() =>
                        setCampaignForm((current) => ({
                          ...current,
                          videoAssetId: asset.id
                        }))
                      }
                    >
                      <strong>{asset.originalName}</strong>
                      <span>{formatBytes(asset.fileSize)}</span>
                      <p>{asset.durationLabel}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  The media library is empty. Upload the first reel in the Upload tab so it can be reused without uploading again.
                </p>
              )}
            </article>
          </div>
          <div className="social-os-side-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Selected asset</span>
                  <h2>Campaign reuse</h2>
                </div>
              </div>
              <p className="empty-state">
                {campaignForm.videoAssetId
                  ? `The editor is currently linked to ${
                      workspace.mediaLibrary.find((asset) => asset.id === campaignForm.videoAssetId)?.originalName ??
                      "the selected reel"
                    }.`
                  : "Pick a saved reel here to attach it to the campaign editor instantly."}
              </p>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "integrations" ? (
        <section className="social-os-grid social-os-integrations-grid">
          {workspace.integrations.map((integration) => (
            <article key={integration.id} className="panel social-os-card social-os-integration-card">
              <div className="panel-heading">
                <div>
                  <span>{integration.platformLabel}</span>
                  <h2>{integration.connectionStatus}</h2>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() =>
                    setModal({
                      type: "remove-integration",
                      platform: integration.platform,
                      platformLabel: integration.platformLabel
                    })
                  }
                >
                  Remove credentials
                </button>
              </div>
              <div className="prompt-editor-grid">
                <label className="field">
                  <span>Saved API key</span>
                  <input value={integration.maskedApiKey ?? "Not saved"} disabled />
                </label>
                <label className="field">
                  <span>New API key / token</span>
                  <input
                    value={integrationDrafts[integration.platform].apiKey}
                    onChange={(event) =>
                      setIntegrationDrafts((current) => ({
                        ...current,
                        [integration.platform]: {
                          ...current[integration.platform],
                          apiKey: event.target.value
                        }
                      }))
                    }
                    placeholder="Paste new token if replacing"
                  />
                </label>
                <label className="field">
                  <span>Saved CLI command</span>
                  <input value={integration.maskedCliCommand ?? "Not saved"} disabled />
                </label>
                <label className="field">
                  <span>New CLI command</span>
                  <input
                    value={integrationDrafts[integration.platform].cliCommand}
                    onChange={(event) =>
                      setIntegrationDrafts((current) => ({
                        ...current,
                        [integration.platform]: {
                          ...current[integration.platform],
                          cliCommand: event.target.value
                        }
                      }))
                    }
                    placeholder="Optional CLI command"
                  />
                </label>
                <label className="field field-span-2">
                  <span>Webhook URL</span>
                  <input
                    value={integrationDrafts[integration.platform].webhookUrl}
                    onChange={(event) =>
                      setIntegrationDrafts((current) => ({
                        ...current,
                        [integration.platform]: {
                          ...current[integration.platform],
                          webhookUrl: event.target.value
                        }
                      }))
                    }
                    placeholder={integration.maskedWebhookUrl ?? "Paste optional webhook URL"}
                  />
                </label>
              </div>
              <div className="social-os-inline-meta">
                <span>Last tested: {formatDate(integration.lastTestedAt)}</span>
                <span>Last successful push: {formatDate(integration.lastSuccessfulPush)}</span>
                <span>Last failed push: {formatDate(integration.lastFailedPush)}</span>
              </div>
              {integration.lastError ? <p className="error-text">{integration.lastError}</p> : null}
              <div className="social-os-editor-actions">
                <button
                  className="sync-button"
                  type="button"
                  onClick={() =>
                    callWorkspaceAction(
                      "save-integration",
                      {
                        platform: integration.platform,
                        ...integrationDrafts[integration.platform]
                      },
                      "Saving integration...",
                      `${integration.platformLabel} credentials saved.`
                    )
                  }
                >
                  Save integration
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() =>
                    callWorkspaceAction(
                      "test-integration",
                      {
                        platform: integration.platform
                      },
                      "Testing connection...",
                      `${integration.platformLabel} connection tested.`
                    )
                  }
                >
                  Test connection
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {activeTab === "logs" ? (
        <section className="social-os-grid">
          <div className="social-os-main-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Audit logs</span>
                  <h2>Tracked activity</h2>
                </div>
              </div>
              {workspace.auditLogs.length ? (
                <div className="timeline-list">
                  {workspace.auditLogs.map((log) => (
                    <div key={log.id} className="timeline-card">
                      <span className="timeline-dot" />
                      <div className="timeline-copy">
                        <div className="timeline-header">
                          <strong>{log.message}</strong>
                          <span>{formatDate(log.createdAt)}</span>
                        </div>
                        <p>
                          {log.eventType} · {log.entityType} · {log.actorUsername ?? "system"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  No audit activity yet. Login attempts, credential changes, campaign edits, pushes, and password updates will appear here.
                </p>
              )}
            </article>
          </div>

          <div className="social-os-side-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Failed pushes</span>
                  <h2>Retry only what failed</h2>
                </div>
              </div>
              {highlightedFailedPosts.length ? (
                <div className="recent-campaigns-list">
                  {highlightedFailedPosts.map(({ campaignId, campaignName, post }) => (
                    <div key={post.id} className="campaign-group-card">
                      <strong>{campaignName}</strong>
                      <span>{post.platformLabel}</span>
                      <p>{post.errorMessage ?? "Unknown error"}</p>
                      <div className="social-os-editor-actions">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() =>
                            callWorkspaceAction(
                              "retry-platform",
                              {
                                campaignId,
                                platform: post.platform
                              },
                              "Retrying failed platform...",
                              `${post.platformLabel} retry completed.`
                            )
                          }
                        >
                          Retry
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() =>
                            setModal({
                              type: "view-log",
                              title: `${post.platformLabel} push log`,
                              body: post.responseLog ?? "No log available."
                            })
                          }
                        >
                          View logs
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  No failed platform pushes right now. If one platform fails later, the others will still continue and the retry controls will show up here.
                </p>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="social-os-grid">
          <div className="social-os-main-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Brand voice</span>
                  <h2>Saved client defaults</h2>
                </div>
              </div>
              <div className="prompt-editor-grid">
                <label className="field">
                  <span>Tone</span>
                  <input
                    value={workspace.brandVoice.tone}
                    onChange={(event) =>
                      handleWorkspaceRefresh({
                        ...workspace,
                        brandVoice: {
                          ...workspace.brandVoice,
                          tone: event.target.value
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Hashtag style</span>
                  <input
                    value={workspace.brandVoice.hashtagStyle}
                    onChange={(event) =>
                      handleWorkspaceRefresh({
                        ...workspace,
                        brandVoice: {
                          ...workspace.brandVoice,
                          hashtagStyle: event.target.value
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>CTA style</span>
                  <input
                    value={workspace.brandVoice.ctaStyle}
                    onChange={(event) =>
                      handleWorkspaceRefresh({
                        ...workspace,
                        brandVoice: {
                          ...workspace.brandVoice,
                          ctaStyle: event.target.value
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Emoji level</span>
                  <input
                    value={workspace.brandVoice.emojiLevel}
                    onChange={(event) =>
                      handleWorkspaceRefresh({
                        ...workspace,
                        brandVoice: {
                          ...workspace.brandVoice,
                          emojiLevel: event.target.value
                        }
                      })
                    }
                  />
                </label>
                <label className="field field-span-2">
                  <span>Product description style</span>
                  <textarea
                    value={workspace.brandVoice.productDescriptionStyle}
                    onChange={(event) =>
                      handleWorkspaceRefresh({
                        ...workspace,
                        brandVoice: {
                          ...workspace.brandVoice,
                          productDescriptionStyle: event.target.value
                        }
                      })
                    }
                  />
                </label>
              </div>
              <div className="social-os-editor-actions">
                <button
                  className="sync-button"
                  type="button"
                  onClick={() =>
                    callWorkspaceAction(
                      "save-brand-voice",
                      {
                        tone: workspace.brandVoice.tone,
                        hashtagStyle: workspace.brandVoice.hashtagStyle,
                        ctaStyle: workspace.brandVoice.ctaStyle,
                        emojiLevel: workspace.brandVoice.emojiLevel,
                        productDescriptionStyle: workspace.brandVoice.productDescriptionStyle
                      },
                      "Saving brand voice...",
                      "Brand voice settings saved."
                    )
                  }
                >
                  Save brand voice
                </button>
              </div>
            </article>
          </div>
          <div className="social-os-side-column">
            <article className="panel social-os-card">
              <div className="panel-heading">
                <div>
                  <span>Safety</span>
                  <h2>Protected actions</h2>
                </div>
              </div>
              <div className="intel-list">
                <div className="intel-item">
                  <span className="intel-dot" />
                  <p>Credentials stay masked after save and can only be replaced or removed intentionally.</p>
                </div>
                <div className="intel-item">
                  <span className="intel-dot" />
                  <p>Every live push requires review confirmation for platforms, caption, CTA, links, and video file.</p>
                </div>
                <div className="intel-item">
                  <span className="intel-dot" />
                  <p>Scheduling is included as a placeholder now, so future automation can plug into the same campaign model later.</p>
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {modal ? (
        <div className="social-os-modal-backdrop">
          <div className="panel social-os-modal">
            {modal.type === "delete-campaign" ? (
              <>
                <h3>Delete campaign</h3>
                <p>
                  Delete &quot;{modal.campaignName}&quot;? This removes the campaign and its
                  platform-specific versions.
                </p>
                <div className="social-os-editor-actions">
                  <button
                    className="sync-button"
                    type="button"
                    onClick={async () => {
                      await callWorkspaceAction(
                        "delete-campaign",
                        { campaignId: modal.campaignId },
                        "Deleting campaign...",
                        "Campaign deleted."
                      );
                      setModal(null);
                    }}
                  >
                    Confirm delete
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {modal.type === "remove-integration" ? (
              <>
                <h3>Remove credentials</h3>
                <p>Remove saved credentials for {modal.platformLabel}? The client will need to reconnect before posting there again.</p>
                <div className="social-os-editor-actions">
                  <button
                    className="sync-button"
                    type="button"
                    onClick={async () => {
                      await callWorkspaceAction(
                        "remove-integration",
                        { platform: modal.platform },
                        "Removing credentials...",
                        `${modal.platformLabel} credentials removed.`
                      );
                      setModal(null);
                    }}
                  >
                    Remove credentials
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {modal.type === "logout" ? (
              <>
                <h3>Log out</h3>
                <p>Confirm logout from the {workspace.client.name} Social OS workspace.</p>
                <div className="social-os-editor-actions">
                  <button className="sync-button" type="button" onClick={handleLogout}>
                    Logout
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {modal.type === "review-push" ? (
              <>
                <h3>Review before push</h3>
                <p>
                  Confirm every approval below before &quot;{modal.campaignName}&quot;
                  can go live.
                </p>
                <div className="social-os-review-grid">
                  {(
                    [
                      ["platformsSelected", "Platforms selected"],
                      ["captionApproved", "Caption approved"],
                      ["ctaApproved", "CTA approved"],
                      ["productLinkApproved", "Product / shop link approved"],
                      ["videoFileApproved", "Video file approved"]
                    ] as Array<[keyof typeof modal.review, string]>
                  ).map(([key, label]) => (
                    <label key={key} className="toggle-chip">
                      <input
                        checked={modal.review[key]}
                        type="checkbox"
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            review: {
                              ...modal.review,
                              [key]: event.target.checked
                            }
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="social-os-editor-actions">
                  <button
                    className="sync-button"
                    type="button"
                    onClick={async () => {
                      await callWorkspaceAction(
                        "push-campaign",
                        {
                          campaignId: modal.campaignId,
                          ...modal.review
                        },
                        "Pushing campaign live...",
                        "Push completed. Successful platforms posted, failed platforms stayed retryable."
                      );
                      setModal(null);
                    }}
                  >
                    Confirm and push live
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {modal.type === "view-log" ? (
              <>
                <h3>{modal.title}</h3>
                <pre className="social-os-log-output">{modal.body}</pre>
                <div className="social-os-editor-actions">
                  <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                    Close
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
