"use client";

import { useMemo, useState } from "react";

import {
  computeHelixLawnLeadEstimate,
  initialHelixLawnLeadInput,
  serviceLabels,
  type HelixLawnLeadInput,
} from "@/lib/helix-lawn-command";

type StoredLeadResponse = {
  id: string;
  stageLabel: string;
  urgency: string;
  confidence: string;
  summary: string;
  estimateLow: number;
  estimateHigh: number;
  serviceLabel: string;
};

type LawnVisionAnalysis = {
  photoAnalysis: string;
  yardSize?: HelixLawnLeadInput["yardSize"];
  grassHeight?: HelixLawnLeadInput["grassHeight"];
  overgrowth?: HelixLawnLeadInput["overgrowth"];
  cleanup?: HelixLawnLeadInput["cleanup"];
  acreage?: string;
  slope?: string;
  access?: string;
  notes?: string;
  confidence?: string;
};

type VisionAnalysisResponse =
  | { ok: true; analysis: LawnVisionAnalysis; imageCount: number }
  | { ok: false; error?: string };

function mergeNotes(current: string, incoming?: string) {
  const next = incoming?.trim();
  if (!next) return current;
  if (!current.trim()) return next;
  if (current.includes(next)) return current;
  return `${current.trim()}\n\nAI vision notes: ${next}`;
}

export function HelixLawnIntakeDemo() {
  const [form, setForm] = useState<HelixLawnLeadInput>(initialHelixLawnLeadInput);
  const [submittedLead, setSubmittedLead] = useState<StoredLeadResponse | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [visionResult, setVisionResult] = useState<LawnVisionAnalysis | null>(null);
  const [isAnalyzingImages, setIsAnalyzingImages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => computeHelixLawnLeadEstimate(form), [form]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/helix-lawn-command/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as
        | { ok: true; lead: StoredLeadResponse }
        | { ok: false; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? "Unable to save lawn lead." : payload.error || "Unable to save lawn lead.");
      }

      setSubmittedLead(payload.lead);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save lawn lead.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleImageAnalysis() {
    setError(null);
    setVisionResult(null);

    if (!selectedImages.length) {
      setError("Upload at least one yard photo before running AI vision.");
      return;
    }

    setIsAnalyzingImages(true);

    try {
      const imagePayload = new FormData();
      selectedImages.slice(0, 4).forEach((image) => imagePayload.append("images", image));

      const response = await fetch("/api/helix-lawn-command/analyze-photo", {
        method: "POST",
        body: imagePayload,
      });

      const payload = (await response.json()) as VisionAnalysisResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? "Unable to analyze lawn photos." : payload.error || "Unable to analyze lawn photos.");
      }

      const analysis = payload.analysis;
      setVisionResult(analysis);
      setForm((prev) => ({
        ...prev,
        yardSize: analysis.yardSize || prev.yardSize,
        grassHeight: analysis.grassHeight || prev.grassHeight,
        overgrowth: analysis.overgrowth || prev.overgrowth,
        cleanup: analysis.cleanup || prev.cleanup,
        acreage: analysis.acreage || prev.acreage,
        slope: analysis.slope || prev.slope,
        access: analysis.access || prev.access,
        notes: mergeNotes(prev.notes, analysis.notes),
        photoAnalysis: analysis.photoAnalysis || prev.photoAnalysis,
      }));
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Unable to analyze lawn photos.");
    } finally {
      setIsAnalyzingImages(false);
    }
  }

  return (
    <section id="demo" className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
      <div className="brand-panel px-6 py-8">
        <p className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">Live demo intake</p>
        <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
          Submit a lawn lead and watch the assistant qualify it in real time.
        </h2>
        <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
          This now writes into the live Helix Lawn Command pipeline, not just a local demo state.
          Every submission can flow straight into the command center.
        </p>

        <div className="mt-6 space-y-3">
          {[
            "Tell us grass height or overgrowth so the crew can price correctly.",
            "Mention cleanup or debris so hauling is included if needed.",
            "Add slope, gates, or access notes when the property is awkward.",
            "Recurring service lowers per-visit pricing and changes close strategy.",
          ].map((tip) => (
            <div key={tip} className="brand-card flex gap-3 p-4">
              <span className="mt-2 h-2 w-2 rounded-full bg-[var(--project-accent)]" />
              <p className="text-sm leading-6 text-[var(--copy-soft)]">{tip}</p>
            </div>
          ))}
        </div>

        <div className="brand-card mt-6 space-y-4 p-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">
            Live estimate preview
          </div>
          <div className="text-3xl font-semibold text-white">
            ${preview.low} - ${preview.high}
          </div>
          <p className="text-sm leading-7 text-[var(--copy-soft)]">{preview.summary}</p>
          <div className="flex flex-wrap gap-2">
            <span className="project-pill">{preview.urgency} urgency</span>
            <span className="project-pill">{preview.confidence}</span>
            <span className="project-pill">{serviceLabels[form.serviceType] ?? "Lawn service"}</span>
          </div>
        </div>

        {submittedLead ? (
          <div className="brand-card mt-6 space-y-4 p-5">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">
              Live pipeline result
            </div>
            <div className="text-3xl font-semibold text-white">
              ${submittedLead.estimateLow} - ${submittedLead.estimateHigh}
            </div>
            <p className="text-sm leading-7 text-[var(--copy-soft)]">{submittedLead.summary}</p>
            <div className="flex flex-wrap gap-2">
              <span className="project-pill">{submittedLead.stageLabel}</span>
              <span className="project-pill">{submittedLead.urgency} urgency</span>
              <span className="project-pill">{submittedLead.confidence}</span>
            </div>
            <div className="text-xs uppercase tracking-[0.22em] text-[var(--copy-muted)]">
              Lead saved · {submittedLead.id}
            </div>
            <button
              type="button"
              onClick={() => {
                setForm(initialHelixLawnLeadInput);
                setSubmittedLead(null);
                setSelectedImages([]);
                setVisionResult(null);
                setError(null);
              }}
              className="project-button inline-flex px-4 py-3 text-sm transition"
            >
              Reset demo
            </button>
          </div>
        ) : null}
      </div>

      <div className="brand-panel px-6 py-8">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          {[
            ["name", "Name *", "Customer name"],
            ["phone", "Phone *", "(336) 555-0000"],
            ["address", "Address *", "Street, City, State"],
            ["preferredDate", "Preferred date", ""],
          ].map(([key, label, placeholder]) => (
            <label key={key} className="grid gap-2 text-sm text-[var(--copy-soft)]">
              <span>{label}</span>
              <input
                type={key === "preferredDate" ? "date" : "text"}
                value={form[key as keyof HelixLawnLeadInput]}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                placeholder={placeholder}
                className={`brand-input rounded-[14px] px-4 py-3 ${key === "preferredDate" ? "brand-date-input" : ""}`}
                required={key === "name" || key === "phone" || key === "address"}
              />
            </label>
          ))}

          <label className="grid gap-2 text-sm text-[var(--copy-soft)]">
            <span>Service type *</span>
            <select
              value={form.serviceType}
              onChange={(event) => setForm((prev) => ({ ...prev, serviceType: event.target.value }))}
              className="brand-input rounded-[14px] px-4 py-3"
            >
              <option value="mowing">Lawn mowing</option>
              <option value="mulch">Mulch install</option>
              <option value="cleanup">Yard cleanup</option>
              <option value="trimming">Bush trimming</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm text-[var(--copy-soft)]">
            <span>Approximate property size / acreage</span>
            <input
              type="text"
              value={form.acreage}
              onChange={(event) => setForm((prev) => ({ ...prev, acreage: event.target.value }))}
              placeholder="Example: 0.5, 1.25, 5, 10"
              className="brand-input rounded-[14px] px-4 py-3"
            />
          </label>

          {([
            ["yardSize", "Yard size", ["small", "medium", "large", "acreage"]],
            ["grassHeight", "Grass height", ["short", "standard", "tall"]],
            ["overgrowth", "Overgrowth level", ["light", "moderate", "heavy"]],
            ["frequency", "One-time or recurring", ["one-time", "weekly", "biweekly"]],
            ["cleanup", "Cleanup / debris involved", ["none", "light", "heavy"]],
          ] as const).map(([key, label, options]) => (
            <label key={key} className="grid gap-2 text-sm text-[var(--copy-soft)]">
              <span>{label}</span>
              <select
                value={form[key as keyof HelixLawnLeadInput]}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                className="brand-input rounded-[14px] px-4 py-3"
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <label className="grid gap-2 text-sm text-[var(--copy-soft)]">
            <span>Number of bushes / hedges</span>
            <input
              type="number"
              min="0"
              value={form.bushes}
              onChange={(event) => setForm((prev) => ({ ...prev, bushes: event.target.value }))}
              className="brand-input rounded-[14px] px-4 py-3"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2">
            <span>Slope or access notes</span>
            <textarea
              value={form.slope}
              onChange={(event) => setForm((prev) => ({ ...prev, slope: event.target.value }))}
              placeholder="Steep hill, narrow gate, backyard only, equipment access issues"
              className="brand-input min-h-[110px] rounded-[14px] px-4 py-3"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2">
            <span>Gates, pets, or access constraints</span>
            <textarea
              value={form.access}
              onChange={(event) => setForm((prev) => ({ ...prev, access: event.target.value }))}
              placeholder="Locked gate, dog in yard, no pets"
              className="brand-input min-h-[110px] rounded-[14px] px-4 py-3"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2">
            <span>Customer notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Anything important about the property or schedule"
              className="brand-input min-h-[110px] rounded-[14px] px-4 py-3"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2">
            <span>Upload yard photos for AI vision</span>
            <div className="brand-card grid gap-4 p-4">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(event) => setSelectedImages(Array.from(event.target.files || []).slice(0, 4))}
                className="brand-input rounded-[14px] px-4 py-3 file:mr-4 file:rounded-full file:border-0 file:bg-[var(--project-accent)] file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-[0.18em] file:text-black"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleImageAnalysis}
                  disabled={!selectedImages.length || isAnalyzingImages}
                  className="project-button inline-flex px-4 py-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAnalyzingImages ? "Reading yard photos..." : "Analyze photos with AI vision"}
                </button>
                <span className="text-xs uppercase tracking-[0.2em] text-[var(--copy-muted)]">
                  {selectedImages.length ? `${selectedImages.length} image${selectedImages.length === 1 ? "" : "s"} selected` : "Up to 4 images"}
                </span>
              </div>
              <p className="text-xs leading-6 text-[var(--copy-muted)]">
                The assistant looks for visible grass height, overgrowth, debris, slope, fences, gates,
                access issues, acreage cues, and manual-review risks before updating the quote fields.
              </p>
              {visionResult ? (
                <div className="rounded-[14px] border border-[color:var(--project-edge)] bg-black/20 px-4 py-3 text-xs leading-6 text-[var(--copy-soft)]">
                  <span className="block text-[10px] uppercase tracking-[0.24em] text-[var(--project-accent)]">
                    Vision analysis applied
                  </span>
                  {visionResult.confidence ? <span className="block">Confidence: {visionResult.confidence}</span> : null}
                  <span className="block">{visionResult.photoAnalysis}</span>
                </div>
              ) : null}
            </div>
          </label>

          <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2">
            <span>AI photo analysis / manual photo notes</span>
            <textarea
              value={form.photoAnalysis}
              onChange={(event) => setForm((prev) => ({ ...prev, photoAnalysis: event.target.value }))}
              placeholder="AI vision will fill this after upload, or describe yard photos manually."
              className="brand-input min-h-[110px] rounded-[14px] px-4 py-3"
            />
          </label>

          <div className="md:col-span-2 rounded-[14px] border border-[color:var(--project-edge)] bg-[color:var(--project-surface)] px-4 py-3 text-sm text-[var(--copy-soft)]">
            Heavy overgrowth, acreage, or unusual access will move the lead into owner review instead
            of blind auto-pricing.
          </div>

          {error ? (
            <div className="md:col-span-2 rounded-[14px] border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="project-button inline-flex px-5 py-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving live lead..." : "Submit lead to AI assistant"}
            </button>
            <span className="text-xs uppercase tracking-[0.22em] text-[var(--copy-muted)]">
              Writes into the command center
            </span>
          </div>
        </form>
      </div>
    </section>
  );
}
