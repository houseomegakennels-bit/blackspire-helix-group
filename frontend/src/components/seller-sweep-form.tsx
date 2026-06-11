"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

type SourceOption = { key: string; label: string; description: string };

type SweepResult = {
  imported?: number;
  scanned?: number;
  message?: string;
};

export function SellerSweepForm({ sources }: { sources: SourceOption[] }) {
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "");
  const [county, setCounty] = useState("");
  const [city, setCity] = useState("");
  const [limit, setLimit] = useState("25");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!county.trim()) {
      setStatus("County is required.");
      return;
    }
    setBusy(true);
    setStatus("Running seller sweep... this can take up to a minute.");
    setResult(null);
    try {
      const response = await fetch("/api/seller-engine/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceKey, county: county.trim(), city: city.trim() || undefined, limit: Number(limit) || 25 }),
      });
      const payload = (await response.json()) as SweepResult & { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        setStatus(payload.error || "Sweep failed.");
        return;
      }
      setResult(payload);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sweep failed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = sources.find((s) => s.key === sourceKey);

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block text-xs uppercase tracking-wider text-[var(--copy-muted)]">Source</label>
        <select
          value={sourceKey}
          onChange={(e) => setSourceKey(e.target.value)}
          className="mt-1 w-full rounded-[12px] border border-[var(--line)] bg-black/40 px-3 py-2.5 text-sm text-white outline-none"
        >
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {selected ? <p className="mt-1 text-xs text-[var(--copy-soft)]">{selected.description}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs uppercase tracking-wider text-[var(--copy-muted)]">County *</label>
          <input
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            placeholder="e.g. Guilford"
            className="mt-1 w-full rounded-[12px] border border-[var(--line)] bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-[var(--copy-muted)]"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-[var(--copy-muted)]">City (optional)</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Greensboro"
            className="mt-1 w-full rounded-[12px] border border-[var(--line)] bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-[var(--copy-muted)]"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-[var(--copy-muted)]">Max leads</label>
        <input
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="mt-1 w-32 rounded-[12px] border border-[var(--line)] bg-black/40 px-3 py-2.5 text-sm text-white outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full border border-[#34d399] bg-[rgba(52,211,153,0.16)] px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#bbf7d0] transition hover:bg-[rgba(52,211,153,0.26)] disabled:opacity-50"
        >
          {busy ? "Sweeping..." : "Launch Seller Sweep"}
        </button>
        {status ? <span className="text-sm text-[var(--copy-soft)]">{status}</span> : null}
      </div>

      {result ? (
        <div className="rounded-[16px] border border-[#34d39955] bg-black/30 p-4">
          <div className="text-sm font-semibold text-white">
            Sweep complete - {result.imported ?? 0} lead{result.imported === 1 ? "" : "s"} imported
            {result.scanned != null ? ` (from ${result.scanned} scanned)` : ""}.
          </div>
          {result.message ? <div className="mt-1 text-xs text-[var(--copy-soft)]">{result.message}</div> : null}
          <Link href="/seller-engine" className="mt-3 inline-flex rounded-full bg-[#34d399] px-5 py-2 text-xs uppercase tracking-[0.18em] text-[#020403]">
            View leads in Seller Engine -&gt;
          </Link>
        </div>
      ) : null}
    </form>
  );
}
