"use client";

import { useState } from "react";

type Result = { inviteUrl: string; linkExpiresAt: string; accessDays: number; accessLevel: "read_only" | "real_estate_operator" };

export function DemoAccessAdmin() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/demo-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: form.get("label"), days: form.get("days"), linkHours: form.get("linkHours"), accessLevel: form.get("accessLevel") }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) return setError(payload.error ?? "Access could not be created.");
    setResult(payload);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <form onSubmit={submit} className="brand-panel space-y-5 p-6">
        <label className="block text-sm text-[var(--copy-soft)]">Invitation label<input name="label" className="brand-input mt-2 w-full" placeholder="Peggy and husband" /></label>
        <label className="block text-sm text-[var(--copy-soft)]">Access window<select name="days" defaultValue="7" className="brand-input mt-2 w-full"><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
        <label className="block text-sm text-[var(--copy-soft)]">Access level<select name="accessLevel" defaultValue="read_only" className="brand-input mt-2 w-full"><option value="read_only">Read-only demonstration</option><option value="real_estate_operator">Full real-estate workspace</option></select></label>
        <label className="block text-sm text-[var(--copy-soft)]">Link expires in<select name="linkHours" defaultValue="48" className="brand-input mt-2 w-full"><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></label>
        <button disabled={busy} className="brand-button px-5 py-3 text-sm uppercase tracking-[0.18em]">{busy ? "Creating…" : "Create invitation link"}</button>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </form>
      <div className="brand-panel p-6">
        <div className="text-xs uppercase tracking-[0.28em] text-[var(--gold-soft)]">Share once</div>
        {result ? <div className="mt-5 space-y-3 text-sm text-white"><label className="block text-[var(--copy-soft)]">One-time signup link<textarea readOnly value={result.inviteUrl} className="brand-input mt-2 min-h-28 w-full font-mono text-xs" /></label><button type="button" onClick={() => navigator.clipboard.writeText(result.inviteUrl)} className="brand-button px-4 py-2 text-xs uppercase tracking-[0.16em]">Copy link</button><p>Link expires: <strong>{new Date(result.linkExpiresAt).toLocaleString()}</strong></p><p>Workspace access: <strong>{result.accessDays} days after signup</strong></p><p>Access level: <strong>{result.accessLevel === "real_estate_operator" ? "Full real-estate workspace" : "Read-only demonstration"}</strong></p><p className="text-[var(--copy-soft)]">The link works once. The client chooses their own email and password.</p></div> : <p className="mt-5 text-sm leading-6 text-[var(--copy-soft)]">Create a private signup link. Choose a read-only tour or time-limited real-estate operator access without exposing Blackspire administration.</p>}
      </div>
    </div>
  );
}
