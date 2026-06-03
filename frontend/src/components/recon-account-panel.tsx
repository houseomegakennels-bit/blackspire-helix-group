"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { reconIndustries } from "@/lib/recon-engine";
import { REFERRAL_REWARD, buildReferralLink } from "@/lib/recon-engine/referrals";

type AccountView = {
  id: string;
  email: string;
  companyName: string | null;
  industry: string | null;
  serviceKeywords: string[];
  countiesServed: string[];
  referralCode: string | null;
  plan: string | null;
};

export function ReconAccountPanel({ account }: { account: AccountView }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(account.companyName ?? "");
  const [industry, setIndustry] = useState(account.industry ?? "");
  const [services, setServices] = useState(account.serviceKeywords.join(", "));
  const [county, setCounty] = useState(account.countiesServed[0] ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const referralLink = account.referralCode ? buildReferralLink(account.referralCode) : null;

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/recon/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, industry, services, county }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed.");
      setStatus("Profile saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await fetch("/api/recon/sign-out", { method: "POST" });
    router.push("/recon-engine");
    router.refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="brand-panel px-6 py-8">
        <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Your profile</p>
        <h2 className="brand-display mt-2 text-2xl text-white">{account.companyName || account.email}</h2>
        <p className="mt-1 text-xs text-[var(--copy-muted)]">{account.email}</p>

        <div className="mt-6 grid gap-4">
          <Field label="Business name">
            <input className="contact-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry">
              <select className="contact-input brand-input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="">Select...</option>
                {reconIndustries.map((i) => (<option key={i} value={i}>{i}</option>))}
              </select>
            </Field>
            <Field label="County">
              <input className="contact-input" value={county} onChange={(e) => setCounty(e.target.value)} />
            </Field>
          </div>
          <Field label="Services (comma-separated)">
            <input className="contact-input" value={services} onChange={(e) => setServices(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={saving} className="recon-button inline-flex px-5 py-3 text-sm uppercase tracking-[0.16em] disabled:opacity-60">
              {saving ? "Saving..." : "Save profile"}
            </button>
            {status ? <span className="text-sm text-emerald-300">{status}</span> : null}
          </div>
          <p className="text-xs text-[var(--copy-muted)]">
            Your profile auto-fills fit scoring on the <a href="/recon-engine/dashboard" style={{ color: "#c4b5fd" }}>dashboard</a>.
          </p>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="brand-panel px-5 py-5">
          <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Plan</p>
          <p className="brand-accent-text mt-2 text-2xl font-black capitalize">{account.plan || "Free preview"}</p>
          <a href="/recon-engine#pricing" className="recon-button mt-4 inline-flex w-full justify-center px-5 py-3 text-sm uppercase tracking-[0.16em]">
            {account.plan ? "Manage plan" : "Upgrade"}
          </a>
        </section>

        <section className="brand-panel px-5 py-5">
          <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Refer &amp; earn</p>
          <p className="mt-2 text-sm text-[var(--copy-soft)]">{REFERRAL_REWARD}.</p>
          {referralLink ? (
            <div className="mt-3">
              <div className="brand-card break-all p-3 text-xs text-[var(--copy-soft)]">{referralLink}</div>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(referralLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="brand-button mt-2 inline-flex px-4 py-2 text-xs uppercase tracking-[0.16em] transition"
              >
                {copied ? "Copied" : "Copy referral link"}
              </button>
            </div>
          ) : null}
        </section>

        <button type="button" onClick={signOut} className="brand-button inline-flex w-full justify-center px-5 py-3 text-sm uppercase tracking-[0.16em] transition">
          Sign out
        </button>
      </aside>
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
