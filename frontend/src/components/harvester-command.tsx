"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { HarvesterSourceType, HarvesterWorkspaceSnapshot } from "@/lib/harvester-server";
import { scoreHarvesterOpportunity, opportunityTierColor } from "@/lib/sentinel-display";

const sourceTypeOptions: Array<{ value: HarvesterSourceType; label: string }> = [
  { value: "facebook_group", label: "Facebook Group" },
  { value: "facebook_marketplace", label: "Facebook Marketplace" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "craigslist", label: "Craigslist" },
  { value: "wholesaler_site", label: "Wholesaler Site" },
  { value: "flyer", label: "Flyer" },
  { value: "pdf", label: "PDF" },
  { value: "manual", label: "Manual" },
  { value: "other", label: "Other" },
];

type TabId = "intake" | "deals" | "intelligence" | "profiles" | "buyers" | "watchlists" | "settings";

type BuyerMatchResult = {
  buyerId: string;
  buyerName: string;
  buyerGroup: string;
  matchScore: number;
  reasons: string[];
  recommendedAction: string;
};
type FindBuyersResult = {
  matches: BuyerMatchResult[];
  validation?: { buyerCount: number; demandScore: number; assignmentPotential: string; county: string | null };
};

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

// Read an uploaded image and downscale/re-encode it to a compact JPEG data URL.
// Keeps the request body well under Vercel's 4.5MB limit and speeds up OCR.
// Returns null for non-image files (e.g. PDFs, which vision OCR can't read).
async function fileToOptimizedImageDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    const img = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image decode failed."));
      img.src = original;
    });
    const maxDim = 1568;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return original; // fall back to the raw data URL if canvas processing fails
  }
}

export function HarvesterCommand({ snapshot }: { snapshot: HarvesterWorkspaceSnapshot }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("intake");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Ready for intake.");
  const [selectedFile, setSelectedFile] = useState<{ name: string; type: string; dataUrl: string | null } | null>(null);
  const [buyerResults, setBuyerResults] = useState<Record<string, FindBuyersResult>>({});
  const [outreach, setOutreach] = useState<Record<string, { subject: string; body: string }>>({});

  async function sendToBuyer(buyerMatchId: string) {
    setBusyLabel("Preparing outreach...");
    try {
      const result = await postJson<{ subject: string; body: string; buyerName: string }>(
        "/api/harvester/buyer-outreach",
        { buyerMatchId },
      );
      setOutreach((prev) => ({ ...prev, [buyerMatchId]: { subject: result.subject, body: result.body } }));
      setStatus(`Outreach prepared for ${result.buyerName}. Copy it below and send through your channel.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not prepare outreach.");
    } finally {
      setBusyLabel(null);
    }
  }
  const [form, setForm] = useState({
    sourceType: "facebook_group" as HarvesterSourceType,
    sourceName: "",
    sourceUrl: "",
    posterName: "",
    propertyAddress: "",
    county: "",
    city: "",
    state: "NC",
    zip: "",
    notes: "",
    originalText: "",
  });

  const pending = Boolean(busyLabel);
  const supportedSources = useMemo(
    () => sourceTypeOptions.map((option) => option.label).join(" / "),
    [],
  );

  async function handleIntakeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyLabel("Extracting opportunity...");
    try {
      const intake = await postJson<{ intake: { id: string } }>(
        "/api/harvester/intake",
        {
          ...form,
          originalFileType: selectedFile?.type || null,
          originalFileUrl: selectedFile?.name || null,
        },
      );

      await postJson("/api/harvester/extract", {
        intakeId: intake.intake.id,
        imageDataUrl: selectedFile?.dataUrl ?? undefined,
        metadata: {
          propertyAddress: form.propertyAddress,
          county: form.county,
          city: form.city,
          state: form.state,
          zip: form.zip,
          posterName: form.posterName,
          notes: form.notes,
          sourceType: form.sourceType,
        },
      });

      setStatus("Harvester intake captured and extracted. Review the deal card below, then approve the record.");
      setForm({
        sourceType: "facebook_group",
        sourceName: "",
        sourceUrl: "",
        posterName: "",
        propertyAddress: "",
        county: "",
        city: "",
        state: "NC",
        zip: "",
        notes: "",
        originalText: "",
      });
      setSelectedFile(null);
      startTransition(() => router.refresh());
      setActiveTab("deals");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create Harvester intake.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function findBuyers(intakeId: string) {
    setBusyLabel("Finding buyers...");
    try {
      const result = await postJson<FindBuyersResult>("/api/harvester/buyer-match", { intakeId });
      const v = result.validation;
      // Show the matches inline on the card immediately (don't wait on a refresh).
      setBuyerResults((prev) => ({ ...prev, [intakeId]: { matches: result.matches ?? [], validation: v } }));
      setStatus(
        v
          ? `${v.buyerCount.toLocaleString()} buyers in ${v.county ?? "county"} · ${v.assignmentPotential} assignment potential · demand ${v.demandScore}/100 · ${result.matches?.length ?? 0} matched.`
          : `${result.matches?.length ?? 0} buyer matches found.`,
      );
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Buyer match failed.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function runAction(label: string, action: () => Promise<unknown>, onSuccess: string, nextTab?: TabId) {
    setBusyLabel(label);
    try {
      await action();
      setStatus(onSuccess);
      if (nextTab) setActiveTab(nextTab);
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function deleteIntake(intakeId: string, label?: string) {
    if (!window.confirm(`Delete this intake${label ? ` (${label})` : ""} and its extracted opportunity? This cannot be undone.`)) {
      return;
    }
    setBusyLabel("Deleting intake...");
    try {
      const response = await fetch(`/api/harvester/intake?id=${encodeURIComponent(intakeId)}`, { method: "DELETE" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Delete failed.");
      }
      setStatus("Intake deleted.");
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete intake.");
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.metrics.map((metric) => (
          <div key={metric.label} className="brand-panel harvester-panel p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{metric.label}</div>
            <div className="mt-3 text-3xl font-black tracking-[0.08em] text-white">{metric.value}</div>
            <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{metric.detail}</div>
          </div>
        ))}
      </div>

      <div className="harvester-status-bar">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">Command Status</div>
          <div className="mt-2 text-sm text-white">{pending ? busyLabel : status}</div>
        </div>
        <div className="text-right text-xs leading-6 text-[var(--copy-soft)]">
          Supported source lanes: {supportedSources}
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {snapshot.tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.22em] transition ${
                isActive
                  ? "border-[var(--line-strong)] bg-[var(--project-surface)] text-white"
                  : "border-[var(--line)] bg-black/20 text-[var(--copy-soft)] hover:border-[var(--line-strong)] hover:text-white"
              }`}
            >
              {tab.label} <span className="ml-2 text-[var(--gold-soft)]">{String(tab.count).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "intake" ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <form onSubmit={handleIntakeSubmit} className="brand-panel harvester-panel harvester-upload-zone space-y-5 p-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--gold-soft)]">Intake</div>
              <h2 className="mt-3 text-2xl font-black tracking-[0.06em] text-white">Capture unstructured opportunity data</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--copy-soft)]">
                Upload screenshot metadata, paste text from Facebook, SMS, email, or flyers, and let Harvester structure the opportunity into Blackspire records.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>Source type</span>
                <select
                  value={form.sourceType}
                  onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value as HarvesterSourceType }))}
                  className="harvester-input"
                >
                  {sourceTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>Source name or group</span>
                <input
                  value={form.sourceName}
                  onChange={(event) => setForm((current) => ({ ...current, sourceName: event.target.value }))}
                  className="harvester-input"
                  placeholder="NC Wholesale Property Network"
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>Source URL</span>
                <input
                  value={form.sourceUrl}
                  onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))}
                  className="harvester-input"
                  placeholder="https://..."
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>Original poster name</span>
                <input
                  value={form.posterName}
                  onChange={(event) => setForm((current) => ({ ...current, posterName: event.target.value }))}
                  className="harvester-input"
                  placeholder="Marcus / Eric Fair / etc."
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>Property address</span>
                <input
                  value={form.propertyAddress}
                  onChange={(event) => setForm((current) => ({ ...current, propertyAddress: event.target.value }))}
                  className="harvester-input"
                  placeholder="421 Branson Street"
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>County</span>
                <input
                  value={form.county}
                  onChange={(event) => setForm((current) => ({ ...current, county: event.target.value }))}
                  className="harvester-input"
                  placeholder="Cumberland"
                />
              </label>
              <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                <span>City</span>
                <input
                  value={form.city}
                  onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                  className="harvester-input"
                  placeholder="Fayetteville"
                />
              </label>
              <div className="grid grid-cols-[1fr_110px] gap-4">
                <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                  <span>State</span>
                  <input
                    value={form.state}
                    onChange={(event) => setForm((current) => ({ ...current, state: event.target.value.toUpperCase() }))}
                    className="harvester-input"
                    maxLength={2}
                    placeholder="NC"
                  />
                </label>
                <label className="space-y-2 text-sm text-[var(--copy-soft)]">
                  <span>Zip</span>
                  <input
                    value={form.zip}
                    onChange={(event) => setForm((current) => ({ ...current, zip: event.target.value }))}
                    className="harvester-input"
                    placeholder="28301"
                  />
                </label>
              </div>
            </div>

            <label className="block space-y-2 text-sm text-[var(--copy-soft)]">
              <span>Upload screenshot, flyer, or PDF metadata</span>
              <div className="harvester-file-field">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      setSelectedFile(null);
                      return;
                    }
                    const type = file.type || "application/octet-stream";
                    setSelectedFile({ name: file.name, type, dataUrl: null });
                    const dataUrl = await fileToOptimizedImageDataUrl(file).catch(() => null);
                    setSelectedFile({ name: file.name, type, dataUrl });
                  }}
                  className="hidden"
                  id="harvester-file-input"
                />
                <label htmlFor="harvester-file-input" className="cursor-pointer">
                  <span className="block text-sm font-semibold text-white">Drop a file or tap to select</span>
                  <span className="mt-2 block text-xs leading-6 text-[var(--copy-soft)]">
                    AI vision OCR is live for images (JPG, PNG, WEBP). Drop a screenshot of a post, listing, or flyer and Harvester reads the price, address, beds/baths, and contact details automatically. PDFs store metadata only for now.
                  </span>
                  {selectedFile ? (
                    <span className="mt-3 inline-flex rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                      {selectedFile.name}
                    </span>
                  ) : null}
                </label>
              </div>
            </label>

            <label className="block space-y-2 text-sm text-[var(--copy-soft)]">
              <span>Paste post, SMS, email, or flyer text</span>
              <textarea
                value={form.originalText}
                onChange={(event) => setForm((current) => ({ ...current, originalText: event.target.value }))}
                className="harvester-textarea"
                rows={10}
                placeholder="Paste the original post or message here..."
              />
            </label>

            <label className="block space-y-2 text-sm text-[var(--copy-soft)]">
              <span>Operator notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="harvester-textarea"
                rows={4}
                placeholder="Context, relationship to the poster, condition clues, or caution notes."
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button disabled={pending} className="brand-button px-6 py-3 text-xs uppercase tracking-[0.22em]" type="submit">
                {pending ? busyLabel ?? "Working..." : "Extract Opportunity"}
              </button>
              <div className="text-xs leading-6 text-[var(--copy-soft)]">
                Only upload content you have permission to use. Do not scrape private platforms or violate group rules.
              </div>
            </div>
          </form>

          <div className="space-y-5">
            <div className="brand-panel harvester-panel p-6">
              <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--gold-soft)]">Pipeline</div>
              <div className="mt-4 grid gap-3">
                {[
                  "Upload or paste opportunity",
                  "Extract structured deal data",
                  "Approve and classify the record",
                  "Send to Seller Engine",
                  "Run Nexus enrichment",
                  "Create Deal Engine record",
                  "Rank Buyer Engine matches",
                ].map((step, index) => (
                  <div key={step} className="harvester-pipeline-step">
                    <span className="harvester-pipeline-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-sm text-white">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="brand-panel harvester-panel p-6">
              <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--gold-soft)]">Current alerts</div>
              <div className="mt-4 space-y-3">
                {snapshot.alerts.map((alert) => (
                  <div key={alert.id} className="rounded-[18px] border border-[var(--line)] bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{alert.title}</div>
                      <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                        alert.severity === "success"
                          ? "bg-emerald-500/12 text-emerald-300"
                          : alert.severity === "warning"
                            ? "bg-amber-500/12 text-amber-300"
                            : "bg-white/8 text-[var(--gold-soft)]"
                      }`}>
                        {alert.severity}
                      </span>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{alert.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "deals" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {snapshot.intakes.length ? snapshot.intakes.map((intake) => (
            <article key={intake.id} className="brand-panel harvester-panel p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.32em] text-[var(--copy-muted)]">
                    {intake.sourceType.replaceAll("_", " ")}{intake.sourceName ? ` / ${intake.sourceName}` : ""}
                  </div>
                  <h3 className="mt-3 text-xl font-black tracking-[0.05em] text-white">
                    {intake.opportunity?.address ?? "Unresolved address"}
                  </h3>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                    {intake.extractionStatus} / {Math.round(intake.extractionConfidence)}%
                  </div>
                  {(() => {
                    const opp = scoreHarvesterOpportunity(intake.opportunity, intake.buyerMatches?.length ?? 0);
                    if (!opp) return null;
                    const color = opportunityTierColor(opp.tier);
                    return (
                      <div
                        className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
                        style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}
                        title={`Opportunity Score™ ${opp.score}/100${opp.potentialAssignmentValue ? ` · ~$${opp.potentialAssignmentValue.toLocaleString()} potential` : ""}`}
                      >
                        Opp {opp.score} · {opp.tier}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {([
                  ["County", intake.opportunity?.county ?? intake.metadata.county ?? "Unknown"],
                  ["City", intake.opportunity?.city ?? intake.metadata.city ?? "Unknown"],
                  ["Asking", intake.opportunity?.askingPrice ? `$${intake.opportunity.askingPrice.toLocaleString()}` : "Not found"],
                  ["Beds / Baths", intake.opportunity?.beds || intake.opportunity?.baths ? `${intake.opportunity.beds ?? "?"} / ${intake.opportunity.baths ?? "?"}` : "Not found"],
                  ["Poster", intake.opportunity?.sellerName ?? String(intake.metadata.posterName ?? "Unknown")],
                  ["Contact", intake.opportunity?.phone ?? intake.opportunity?.email ?? "Not found"],
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="rounded-[18px] border border-[var(--line)] bg-black/20 p-4">
                    <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{label}</div>
                    <div className="mt-2 text-sm leading-6 text-white">{value}</div>
                  </div>
                ))}
              </div>

              {intake.opportunity?.missingFields?.length ? (
                <div className="mt-4 rounded-[18px] border border-amber-400/25 bg-amber-500/8 p-4 text-sm leading-6 text-amber-100">
                  Missing fields: {intake.opportunity.missingFields.join(", ")}
                </div>
              ) : null}

              {intake.duplicates?.length ? (
                <div className="mt-4 rounded-[18px] border border-red-400/25 bg-red-500/8 p-4 text-sm leading-6 text-red-100">
                  Potential duplicate found: {intake.duplicates[0]?.reasons.join(" ")}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Extracting...", () => postJson("/api/harvester/extract", { intakeId: intake.id }), "Extraction refreshed for the selected intake.")}
                >
                  Extract
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Approving...", () => postJson("/api/harvester/approve", { intakeId: intake.id }), "Extraction approved. Duplicate and watchlist checks refreshed.")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Sending to Seller Engine...", () => postJson("/api/harvester/create-seller-lead", { intakeId: intake.id }), "Harvester intake pushed into Seller Engine.")}
                >
                  Send to Seller
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Running Nexus...", () => postJson("/api/harvester/create-seller-lead", { intakeId: intake.id, runNexus: true }), "Nexus enrichment hook triggered for the Harvester intake.")}
                >
                  Run Nexus
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Creating deal...", () => postJson("/api/harvester/create-deal", { intakeId: intake.id }), "Deal Engine record created or refreshed from the Harvester intake.")}
                >
                  Create Deal
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => findBuyers(intake.id)}
                >
                  Find Buyers
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Checking duplicates...", () => postJson("/api/harvester/duplicates", { intakeId: intake.id, persist: true }), "Duplicate scan completed for the selected intake.")}
                >
                  Check Duplicates
                </button>
                <button
                  type="button"
                  className="harvester-action-button"
                  onClick={() => runAction("Updating poster profile...", () => postJson("/api/harvester/entities", { intakeId: intake.id }), "Marketplace entity profile updated from this intake.", "profiles")}
                >
                  Update Profile
                </button>
                <button
                  type="button"
                  className="harvester-action-button harvester-action-button--danger"
                  onClick={() => deleteIntake(intake.id, intake.opportunity?.address ?? intake.sourceName ?? undefined)}
                >
                  Delete
                </button>
              </div>

              {buyerResults[intake.id] ? (
                <div className="mt-5 rounded-[18px] border border-[var(--line-strong)] bg-black/25 p-4">
                  {buyerResults[intake.id].validation ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-[rgba(45,212,191,0.12)] px-3 py-1 uppercase tracking-[0.16em] text-[#5eead4]">
                        {buyerResults[intake.id].validation!.buyerCount.toLocaleString()} buyers in {buyerResults[intake.id].validation!.county ?? "county"}
                      </span>
                      <span className="rounded-full border border-[var(--line)] px-3 py-1 uppercase tracking-[0.16em] text-[var(--copy-soft)]">
                        {buyerResults[intake.id].validation!.assignmentPotential} assignment potential
                      </span>
                      <span className="rounded-full border border-[var(--line)] px-3 py-1 uppercase tracking-[0.16em] text-[var(--copy-soft)]">
                        demand {buyerResults[intake.id].validation!.demandScore}/100
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {buyerResults[intake.id].matches.length ? (
                      buyerResults[intake.id].matches.slice(0, 6).map((match) => (
                        <div key={match.buyerId} className="rounded-[12px] border border-[var(--line)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-white">{match.buyerName}</span>
                            <span className="shrink-0 text-sm font-bold text-[var(--gold-soft)]">{match.matchScore}</span>
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--copy-muted)]">{match.buyerGroup?.replaceAll("_", " ")}</div>
                          {match.reasons?.length ? <div className="mt-1 text-xs text-[var(--copy-soft)]">{match.reasons.slice(0, 2).join(" · ")}</div> : null}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[var(--copy-soft)]">No buyers indexed for this county yet. Launch a Buyer Engine search to ingest them.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          )) : (
            <div className="brand-panel harvester-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">
              No extracted deals yet. Start from the Intake tab with pasted text or a screenshot metadata upload.
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "intelligence" || activeTab === "profiles" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {snapshot.entities.length ? snapshot.entities.map((entity) => (
            <article key={entity.id} className="brand-panel harvester-panel p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">{entity.entityType}</div>
                  <h3 className="mt-3 text-xl font-black tracking-[0.05em] text-white">{entity.entityName}</h3>
                </div>
                <div className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                  {Math.round(entity.classificationConfidence)}% confidence
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {([
                  ["Posts imported", String(entity.postCount)],
                  ["Deals created", String(entity.dealCount)],
                  ["Avg asking", entity.averageAskingPrice ? `$${Math.round(entity.averageAskingPrice).toLocaleString()}` : "N/A"],
                  ["Reputation", String(Math.round(entity.reputationScore))],
                  ["Phone", entity.phone ?? "Not found"],
                  ["Email", entity.email ?? "Not found"],
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="rounded-[18px] border border-[var(--line)] bg-black/20 p-4">
                    <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{label}</div>
                    <div className="mt-2 text-sm leading-6 text-white">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
                Markets: {entity.markets.length ? entity.markets.join(" / ") : "No market pattern recorded yet."}
              </div>
            </article>
          )) : (
            <div className="brand-panel harvester-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">
              No poster profiles yet. Use “Update Profile” on an extracted deal to build marketplace intelligence entities over time.
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "buyers" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {snapshot.buyerMatches.length ? snapshot.buyerMatches.map((match) => (
            <article key={match.id} className="brand-panel harvester-panel p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">{match.buyerGroup ?? "Buyer Group"}</div>
                  <h3 className="mt-3 text-xl font-black tracking-[0.05em] text-white">{match.buyerName}</h3>
                </div>
                <div className="harvester-confidence-ring">{Math.round(match.matchScore)}%</div>
              </div>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--copy-soft)]">
                {match.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
              <div className="mt-4 rounded-[18px] border border-[var(--line)] bg-black/20 p-4 text-sm leading-6 text-white">
                {match.recommendedAction ?? "Review this buyer signal in Buyer Engine."}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="harvester-action-button"
                  disabled={pending}
                  onClick={() => sendToBuyer(match.id)}
                >
                  {outreach[match.id] ? "Regenerate Outreach" : "Send to Buyer"}
                </button>
                {outreach[match.id] ? (
                  <button
                    type="button"
                    className="harvester-mini-link"
                    onClick={() => {
                      const o = outreach[match.id];
                      navigator.clipboard?.writeText(`Subject: ${o.subject}\n\n${o.body}`);
                      setStatus("Outreach copied to clipboard.");
                    }}
                  >
                    Copy message
                  </button>
                ) : null}
              </div>
              {outreach[match.id] ? (
                <div className="mt-3 rounded-[16px] border border-[#2dd4bf55] bg-black/30 p-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[#5eead4]">Ready to send</div>
                  <div className="mt-2 text-sm font-semibold text-white">{outreach[match.id].subject}</div>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-6 text-[var(--copy-soft)]">{outreach[match.id].body}</pre>
                </div>
              ) : null}
            </article>
          )) : (
            <div className="brand-panel harvester-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">
              No buyer matches saved yet. Create or refresh a deal, then run Buyer Match from the Extracted Deals tab.
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "watchlists" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {snapshot.watchlists.length ? snapshot.watchlists.map((watchlist) => (
            <article key={watchlist.id} className="brand-panel harvester-panel p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">Marketplace Watchlist</div>
                  <h3 className="mt-3 text-xl font-black tracking-[0.05em] text-white">{watchlist.name}</h3>
                </div>
                <div className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                  {watchlist.notifyOnMatch ? "notify on match" : "manual review"}
                </div>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-[18px] border border-[var(--line)] bg-black/20 p-4 text-xs leading-6 text-[var(--copy-soft)]">
                {JSON.stringify(watchlist.criteria, null, 2)}
              </pre>
            </article>
          )) : (
            <div className="brand-panel harvester-panel p-6 text-sm leading-7 text-[var(--copy-soft)]">
              No watchlists configured yet. The migration seeds a default NC buy-box watchlist once Supabase is active.
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="brand-panel harvester-panel p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--gold-soft)]">Current posture</div>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--copy-soft)]">
              <li>Text extraction is live for pasted posts, SMS, email, and manual entry.</li>
              <li>Screenshot/PDF uploads currently preserve metadata and are ready for OCR provider attachment.</li>
              <li>Seller Engine, Nexus, Deal Engine, and Buyer Engine handoff actions are all wired from the deal review cards.</li>
              <li>Marketplace entities accumulate poster history over time so repeat wholesalers or sellers can be tracked.</li>
            </ul>
          </div>
          <div className="brand-panel harvester-panel p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--gold-soft)]">Operator reminders</div>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--copy-soft)]">
              <li>Only upload content you have permission to use.</li>
              <li>Do not scrape private platforms or break group rules.</li>
              <li>Use the source metadata fields so Harvester can score duplicates and poster reputation accurately.</li>
              <li>Run approval before seller/deal handoff so the pipeline stays clean.</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
