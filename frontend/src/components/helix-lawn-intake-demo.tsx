"use client";

import { useMemo, useState } from "react";

type DemoState = {
  name: string;
  phone: string;
  address: string;
  serviceType: string;
  preferredDate: string;
  acreage: string;
  yardSize: string;
  grassHeight: string;
  overgrowth: string;
  bushes: string;
  frequency: string;
  cleanup: string;
  slope: string;
  access: string;
  notes: string;
  photoAnalysis: string;
};

const initialState: DemoState = {
  name: "",
  phone: "",
  address: "",
  serviceType: "mowing",
  preferredDate: "",
  acreage: "",
  yardSize: "medium",
  grassHeight: "standard",
  overgrowth: "light",
  bushes: "0",
  frequency: "one-time",
  cleanup: "none",
  slope: "",
  access: "",
  notes: "",
  photoAnalysis: "",
};

const serviceLabels: Record<string, string> = {
  mowing: "Lawn mowing",
  mulch: "Mulch install",
  cleanup: "Yard cleanup",
  trimming: "Bush trimming",
};

const yardBase: Record<string, number> = {
  small: 65,
  medium: 105,
  large: 165,
  acreage: 230,
};

const grassAdjust: Record<string, number> = {
  short: 0,
  standard: 14,
  tall: 32,
};

const overgrowthAdjust: Record<string, number> = {
  light: 0,
  moderate: 24,
  heavy: 58,
};

const cleanupAdjust: Record<string, number> = {
  none: 0,
  light: 30,
  heavy: 70,
};

const frequencyAdjust: Record<string, number> = {
  "one-time": 1,
  weekly: 0.84,
  biweekly: 0.92,
};

export function HelixLawnIntakeDemo() {
  const [form, setForm] = useState(initialState);
  const [submitted, setSubmitted] = useState(false);

  const result = useMemo(() => {
    const base = yardBase[form.yardSize] ?? 105;
    const bushes = Number(form.bushes || 0) * 9;
    const subtotal =
      base +
      (grassAdjust[form.grassHeight] ?? 14) +
      (overgrowthAdjust[form.overgrowth] ?? 0) +
      (cleanupAdjust[form.cleanup] ?? 0) +
      bushes;
    const multiplier = frequencyAdjust[form.frequency] ?? 1;
    const adjusted = Math.round(subtotal * multiplier);
    const low = Math.max(45, Math.round(adjusted * 0.9));
    const high = Math.round(adjusted * 1.14);
    const urgency =
      form.overgrowth === "heavy" ? "high" : form.cleanup === "heavy" ? "medium" : "standard";
    const confidence =
      form.photoAnalysis || form.notes || form.acreage ? "higher confidence" : "owner review recommended";
    const summary = `${serviceLabels[form.serviceType]} lead for ${form.address || "local property"} with ${form.yardSize} yard, ${form.grassHeight} grass, and ${form.overgrowth} overgrowth.`;
    return {
      low,
      high,
      urgency,
      confidence,
      summary,
    };
  }, [form]);

  return (
    <section id="demo" className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
      <div className="brand-panel px-6 py-8">
        <p className="text-xs uppercase tracking-[0.36em] text-[var(--project-accent)]">Live demo intake</p>
        <h2 className="brand-display mt-3 text-4xl leading-tight text-white">
          Submit a lawn lead and watch the assistant qualify it in real time.
        </h2>
        <p className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
          This recreates the old Helix Lawn Command demo surface: lead intake, basic qualification,
          estimate guidance, and a fast owner-facing summary.
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

        {submitted ? (
          <div className="brand-card mt-6 space-y-4 p-5">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--copy-muted)]">
              Intake assistant result
            </div>
            <div className="text-3xl font-semibold text-white">
              ${result.low} - ${result.high}
            </div>
            <p className="text-sm leading-7 text-[var(--copy-soft)]">{result.summary}</p>
            <div className="flex flex-wrap gap-2">
              <span className="project-pill">{result.urgency} urgency</span>
              <span className="project-pill">{result.confidence}</span>
              <span className="project-pill">{serviceLabels[form.serviceType]}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setForm(initialState);
                setSubmitted(false);
              }}
              className="project-button inline-flex px-4 py-3 text-sm transition"
            >
              Reset demo
            </button>
          </div>
        ) : null}
      </div>

      <div className="brand-panel px-6 py-8">
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
          }}
        >
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
                value={form[key as keyof DemoState]}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                placeholder={placeholder}
                className={`brand-input rounded-[14px] px-4 py-3 ${key === "preferredDate" ? "brand-date-input" : ""}`}
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
                value={form[key as keyof DemoState]}
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
            Some pricing details are still approximate. The AI may flag this for owner review.
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="project-button inline-flex px-5 py-4 text-sm transition">
              Submit lead to AI assistant
            </button>
            <span className="text-xs uppercase tracking-[0.22em] text-[var(--copy-muted)]">
              Preliminary estimate guidance only
            </span>
          </div>
        </form>
      </div>
    </section>
  );
}
