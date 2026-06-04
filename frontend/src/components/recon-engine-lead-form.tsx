"use client";

import { useState } from "react";

import { reconIndustries, type LeadScanInput } from "@/lib/recon-engine";

const initialInput: LeadScanInput = {
  name: "",
  companyName: "",
  email: "",
  industry: "",
  services: "",
  county: "",
  state: "NC",
  referralCode: "",
};

export function ReconEngineLeadForm({ defaultIndustry }: { defaultIndustry?: string } = {}) {
  const referralCode =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("ref")?.slice(0, 32) ?? "";
  const [form, setForm] = useState<LeadScanInput>(
    defaultIndustry
      ? { ...initialInput, industry: defaultIndustry, referralCode }
      : { ...initialInput, referralCode },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  function update<K extends keyof LeadScanInput>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/recon-engine/lead-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as
        | { ok: true; id: string; snapshot: string }
        | { ok: false; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? "Scan failed." : payload.error || "Scan failed.");
      }
      setSnapshot(payload.snapshot);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Scan failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (snapshot) {
    return (
      <div className="brand-card p-6" style={{ borderColor: "rgba(139,92,246,0.4)" }}>
        <div className="flex items-center gap-3">
          <span className="live-dot" />
          <p className="cmd-text" style={{ color: "#c4b5fd" }}>
            Opportunity Snapshot ready
          </p>
        </div>
        <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-6 text-[var(--copy-soft)]">
          {snapshot}
        </pre>
        <p className="mt-4 text-sm text-[var(--copy-soft)]">
          We saved this scan and will follow up. Want live, fit-scored opportunities matched to
          you automatically? That&apos;s what the Recon Engine plans below do.
        </p>
        <button
          type="button"
          onClick={() => {
            setForm(initialInput);
            setSnapshot(null);
            setError(null);
          }}
          className="brand-button mt-5 inline-flex px-5 py-3 text-sm uppercase tracking-[0.18em] transition"
        >
          Run another scan
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name *">
          <input className="contact-input" value={form.name} required
            onChange={(e) => update("name", e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="Business name">
          <input className="contact-input" value={form.companyName}
            onChange={(e) => update("companyName", e.target.value)} placeholder="Your company" />
        </Field>
      </div>

      <Field label="Email *">
        <input className="contact-input" type="email" value={form.email} required
          onChange={(e) => update("email", e.target.value)} placeholder="you@company.com" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Industry">
          <select className="contact-input brand-input" value={form.industry}
            onChange={(e) => update("industry", e.target.value)}>
            <option value="">Select industry...</option>
            {reconIndustries.map((industry) => (
              <option key={industry} value={industry}>{industry}</option>
            ))}
          </select>
        </Field>
        <Field label="Services offered">
          <input className="contact-input" value={form.services}
            onChange={(e) => update("services", e.target.value)} placeholder="e.g. mowing, cleanup, hauling" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="County">
          <input className="contact-input" value={form.county}
            onChange={(e) => update("county", e.target.value)} placeholder="e.g. Forsyth" />
        </Field>
        <Field label="State">
          <input className="contact-input" value={form.state}
            onChange={(e) => update("state", e.target.value)} placeholder="NC" />
        </Field>
      </div>

      {error ? (
        <div className="rounded-[14px] border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="recon-button inline-flex w-full items-center justify-center gap-2 px-6 py-4 text-sm uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{submitting ? "Scanning opportunities..." : "Get my free opportunity scan"}</span>
        <span className="live-dot" />
      </button>
      <p className="text-center text-xs text-[var(--copy-muted)]">
        Free. No credit card. We&apos;ll email your snapshot and follow up.
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{label}</span>
      {children}
    </label>
  );
}
