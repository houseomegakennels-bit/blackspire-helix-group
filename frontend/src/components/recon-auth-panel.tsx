"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { reconIndustries } from "@/lib/recon-engine";

export function ReconAuthPanel() {
  const router = useRouter();
  const initialRef =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("ref")?.slice(0, 32) ?? null;
  const [mode, setMode] = useState<"signin" | "signup">(initialRef ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [services, setServices] = useState("");
  const [county, setCounty] = useState("");
  const [referredBy] = useState(initialRef ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "signup" ? "/api/recon/sign-up" : "/api/recon/sign-in";
      const payload =
        mode === "signup"
          ? { email, password, companyName, industry, services, county, referredBy }
          : { email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong.");
      router.push("/recon-engine/account");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="brand-panel mx-auto max-w-xl px-6 py-8">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`flex-1 rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${mode === "signin" ? "border-[hsl(258_90%_70%/.6)] text-white" : "border-[var(--line)] text-[var(--copy-muted)]"}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${mode === "signup" ? "border-[hsl(258_90%_70%/.6)] text-white" : "border-[var(--line)] text-[var(--copy-muted)]"}`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 grid gap-4">
        <Field label="Email *">
          <input className="contact-input" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Field label="Password *">
          <input className="contact-input" type="password" value={password} required minLength={8} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </Field>

        {mode === "signup" ? (
          <>
            <Field label="Business name">
              <input className="contact-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Industry">
                <select className="contact-input brand-input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  <option value="">Select...</option>
                  {reconIndustries.map((i) => (<option key={i} value={i}>{i}</option>))}
                </select>
              </Field>
              <Field label="County">
                <input className="contact-input" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="Forsyth" />
              </Field>
            </div>
            <Field label="Services (comma-separated)">
              <input className="contact-input" value={services} onChange={(e) => setServices(e.target.value)} placeholder="mowing, cleanup, hauling" />
            </Field>
            {referredBy ? (
              <p className="text-xs" style={{ color: "#c4b5fd" }}>Referred by code: {referredBy}</p>
            ) : null}
          </>
        ) : null}

        {error ? (
          <div className="rounded-[14px] border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
        ) : null}

        <button type="submit" disabled={loading} className="recon-button inline-flex w-full justify-center px-6 py-4 text-sm uppercase tracking-[0.2em] disabled:opacity-60">
          {loading ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
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
