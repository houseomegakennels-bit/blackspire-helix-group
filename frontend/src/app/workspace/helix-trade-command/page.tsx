"use client";

import { useEffect, useState } from "react";

type Status = {
  hypothesis: string;
  validation_start: string;
  days_recorded: number;
  events: number;
  wins: number;
  success_pct: number | null;
  wilson95: [number | null, number | null];
  gate_status: string;
  events_remaining: number;
  ledger_tip_sha256?: string;
  live_trading: boolean;
  updated_at_utc?: string;
  status?: string;
};

const fmt = (v: number | null | undefined, suffix = "") => v == null ? "—" : `${v.toFixed(1)}${suffix}`;

export default function HelixTradeCommandPage() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/helix-trade/research-status", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.status || `HTTP ${res.status}`);
        if (active) { setData(body); setError(null); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Unavailable"); }
    };
    load(); const id = setInterval(load, 60_000); return () => { active = false; clearInterval(id); };
  }, []);

  return <main className="min-h-screen bg-black px-4 py-10 text-white lg:px-10">
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.3em] text-teal-300">Zola · Helix Trade Command</p><h1 className="mt-2 text-3xl font-black">R1 Prospective Evidence</h1><p className="mt-2 max-w-2xl text-sm text-zinc-400">Read-only research telemetry. This surface cannot place orders, clear halts, or authorize broker execution.</p></div>
        <div className="rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200">LIVE TRADING DISABLED</div>
      </div>
      {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">Status unavailable: {error}</div>}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Events", data ? `${data.events} / 30` : "—"],
          ["Wins", data ? String(data.wins) : "—"],
          ["Success", data ? fmt(data.success_pct, "%") : "—"],
          ["Gate", data?.gate_status ?? "—"],
        ].map(([k,v]) => <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{k}</p><p className="mt-2 text-2xl font-black">{v}</p></div>)}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="font-bold">Frozen gate</h2><p className="mt-3 text-sm text-zinc-300">Minimum 30 counted M6E events · success ≥55% · Wilson 95% lower bound &gt;50%.</p><p className="mt-3 text-sm text-zinc-400">Events remaining: <b className="text-white">{data?.events_remaining ?? "—"}</b></p><p className="mt-1 text-sm text-zinc-400">Wilson 95%: <b className="text-white">[{fmt(data?.wilson95?.[0], "%")}, {fmt(data?.wilson95?.[1], "%")}]</b></p></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="font-bold">Evidence integrity</h2><p className="mt-3 break-all font-mono text-xs text-zinc-400">Ledger tip: {data?.ledger_tip_sha256 ?? "—"}</p><p className="mt-3 text-sm text-zinc-400">Validation starts {data?.validation_start ?? "2026-09-12"}. Days recorded: {data?.days_recorded ?? 0}.</p><p className="mt-1 text-xs text-zinc-500">Updated: {data?.updated_at_utc ?? "—"}</p></div>
      </section>
    </div>
  </main>;
}
