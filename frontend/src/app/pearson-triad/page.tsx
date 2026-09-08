import { pearsonTriadBrand as brand } from "@/lib/pearson-triad-brand";

const phases = [
  ["Today", "Build", "Company setup package, sales kit, partner + contract research, pricing engine"],
  ["Days 1–7", "Qualify", "Provider coverage, top prospects, walkthroughs, live opportunities"],
  ["Days 8–14", "Close", "Partner-priced proposals, negotiations, first profitable contract target"],
  ["Days 15–45", "Prove + Scale", "Mobilize, inspect quality, collect, add a second funded account"],
];

const lanes = [
  { title: "Fast Contract", copy: "Professional offices, property managers, and light-industrial offices with local decision makers." },
  { title: "Contract Hunter", copy: "Municipal, county, state, and other procurement opportunities monitored and scored in parallel." },
  { title: "Fulfillment", copy: "Primary commercial cleaning partner + backup coverage + independent QC. Owner cleaning is never the fallback." },
];

export default function PearsonTriadPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-400">Blackspire Business Branch</p>
        <h1 className="mt-4 max-w-4xl text-5xl font-black tracking-tight md:text-7xl">{brand.businessName} <span className="text-emerald-400">{brand.divisionName}</span></h1>
        <p className="mt-6 max-w-3xl text-xl text-slate-300">{brand.tagline} A lean, partner-fulfilled expansion built to reach the Triad quickly without turning ownership into frontline cleaning labor.</p>
        <div className="mt-8 flex flex-wrap gap-3">{brand.primaryCities.map((city) => <span key={city} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">{city}</span>)}</div>
      </section>

      <section className="border-y border-slate-800 bg-slate-900/60">
        <div className="mx-auto grid max-w-6xl gap-4 px-6 py-10 md:grid-cols-3">
          {lanes.map((lane) => <article key={lane.title} className="rounded-2xl border border-slate-800 bg-slate-950 p-6"><h2 className="text-xl font-bold text-emerald-400">{lane.title}</h2><p className="mt-3 text-slate-300">{lane.copy}</p></article>)}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-end justify-between gap-6"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-blue-400">Launch clock</p><h2 className="mt-2 text-4xl font-black">45-day path to a profitable operating branch</h2></div><div className="hidden rounded-2xl bg-emerald-400 px-5 py-3 font-black text-slate-950 md:block">FIRST CONTRACT TARGET: 14 DAYS</div></div>
        <div className="mt-8 grid gap-4 md:grid-cols-4">{phases.map(([time, title, copy]) => <article key={time} className="rounded-2xl bg-white p-5 text-slate-950"><p className="text-sm font-bold text-blue-600">{time}</p><h3 className="mt-2 text-2xl font-black">{title}</h3><p className="mt-3 text-sm text-slate-600">{copy}</p></article>)}</div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl bg-emerald-400 p-8 text-slate-950 md:p-10"><p className="text-sm font-bold uppercase tracking-[0.25em]">Operating rule</p><h2 className="mt-2 text-3xl font-black md:text-5xl">You lead the business. Partners execute the cleaning.</h2><p className="mt-4 max-w-3xl text-lg">Pricing, pipeline, approvals, partner coverage, QC, and cash-to-first-payment are managed as business systems. Zola-ready interfaces can be documented now, but this branch remains fully Blackspire-native until Zola production is complete.</p></div>
      </section>
    </main>
  );
}
