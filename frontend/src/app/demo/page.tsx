import Image from "next/image";

import { getDemoSnapshot } from "@/lib/demo-access-server";
import { requireDemoViewerPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

const stages = [
  ["Harvester", "Captures opportunities from posts, screenshots, emails, flyers, and manual intake."],
  ["Seller Engine", "Scores motivated-seller signals and organizes lead readiness."],
  ["Deal Engine", "Keeps underwriting, negotiation, contracts, and closing work in one lane."],
  ["Buyer Engine", "Ranks verified buyer activity so disposition starts with evidence."],
  ["Sentinel", "Surfaces follow-ups and operational exceptions across the pipeline."],
];

export default async function DemoPage() {
  const context = await requireDemoViewerPage();
  const snapshot = await getDemoSnapshot();
  const expires = context.expiresAt ? new Date(context.expiresAt).toLocaleDateString() : "by arrangement";
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(214,168,79,.13),transparent_30%),#030303] px-5 py-10 text-white"><div className="mx-auto max-w-6xl"><header className="flex flex-col gap-6 border-b border-white/10 pb-9 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><Image src="/brand/blackspire-helix-group-logo-fit.png" alt="Blackspire Helix Group" width={88} height={88} className="h-20 w-20 object-contain" /><div><p className="text-xs uppercase tracking-[.35em] text-amber-200">Protected read-only demonstration</p><h1 className="mt-2 text-3xl font-black">Real Estate Operations Platform</h1></div></div><div className="rounded-xl border border-amber-200/20 bg-amber-200/5 px-4 py-3 text-sm text-zinc-300">Access expires {expires}</div></header><section className="py-10"><p className="max-w-3xl text-lg leading-8 text-zinc-300">This is a live-system view with private seller contacts, mailing addresses, document links, and workflow controls removed. The counts below are read at sign-in, not typed into a sales deck.</p><div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(snapshot.metrics).map(([key,value]) => <div key={key} className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><div className="text-3xl font-black text-amber-200">{value.toLocaleString()}</div><div className="mt-2 text-xs uppercase tracking-[.18em] text-zinc-500">{key.replace(/([A-Z])/g," $1")}</div></div>)}</div></section><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{stages.map(([name,copy],index) => <article key={name} className="rounded-2xl border border-white/10 bg-zinc-950 p-5"><div className="text-xs font-bold text-amber-200">0{index+1}</div><h2 className="mt-3 text-xl font-bold">{name}</h2><p className="mt-3 text-sm leading-6 text-zinc-400">{copy}</p></article>)}</section><section className="mt-10 rounded-3xl border border-white/10 bg-white/[.035] p-6"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs uppercase tracking-[.3em] text-amber-200">Buyer intelligence sample</p><h2 className="mt-2 text-2xl font-black">Verified activity, private details removed</h2></div><p className="text-xs text-zinc-500">Captured {new Date(snapshot.capturedAt).toLocaleString()}</p></div><div className="mt-6 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-zinc-500"><tr className="border-b border-white/10"><th className="py-3">Buyer entity</th><th>Purchases</th><th>Score</th><th>Signals</th></tr></thead><tbody>{snapshot.buyers.map((buyer) => <tr key={`${buyer.name}-${buyer.score}`} className="border-b border-white/5"><td className="py-4 font-semibold">{buyer.name}</td><td>{buyer.purchases}</td><td>{buyer.score}</td><td>{[buyer.entity ? "Entity" : null,buyer.cash ? "Cash" : null].filter(Boolean).join(" • ") || "Recorded"}</td></tr>)}</tbody></table></div></section><footer className="py-10 text-sm leading-6 text-zinc-500">Demonstration access is view-only. It cannot send outreach, export records, change deal stages, or reveal protected contact information.</footer></div></main>;
}
