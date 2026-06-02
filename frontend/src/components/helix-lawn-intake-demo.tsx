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

export function HelixLawnIntakeDemo() {
  const [form, setForm] = useState<HelixLawnLeadInput>(initialHelixLawnLeadInput);
  const [submittedLead, setSubmittedLead] = useState<StoredLeadResponse | null>(null);
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
            <span>Photo analysis (optional)</span>
            <textarea
              value={form.photoAnalysis}
              onChange={(event) => setForm((prev) => ({ ...prev, photoAnalysis: event.target.value }))}
              placeholder="Describe yard photos, e.g. overgrown 0.25 acre with slope"
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
