"use client";

import Link from "next/link";
import { useDeferredValue, useState, type FormEvent } from "react";

import {
  SELLER_LIVE_SOURCES,
  DEFAULT_SELLER_SCORING_WEIGHTS,
  SELLER_LEAD_STATUSES,
  SELLER_SOURCE_TYPES,
  sellerCsvTemplate,
  type SellerLeadStatus,
  type SellerLiveSourceKey,
  type SellerScoringWeights,
} from "@/lib/seller-engine";
import type { SellerLeadView } from "@/lib/seller-engine-demo";

type AlertRow = { id: string; title: string; message: string; alert_type: string; read: boolean; created_at: string };
type SourceRow = { id: string; name: string; county?: string | null; source_type: string; integration_type: string; active: boolean; last_imported_at?: string | null; configuration?: { notes?: string; starterPack?: boolean } | null };

const LIVE_SEARCH_PRESETS: Array<{
  label: string;
  county: string;
  city: string;
  limit: number;
  sourceKey: SellerLiveSourceKey;
}> = [
  { label: "Charlotte Full Sweep", county: "Mecklenburg", city: "Charlotte", limit: 25, sourceKey: "nc_onemap_full_recon_sweep" },
  { label: "Raleigh Full Sweep", county: "Wake", city: "Raleigh", limit: 25, sourceKey: "nc_onemap_full_recon_sweep" },
  { label: "Winston-Salem Sweep", county: "Forsyth", city: "Winston-Salem", limit: 25, sourceKey: "nc_onemap_full_recon_sweep" },
  { label: "Wake Absentee", county: "Wake", city: "Raleigh", limit: 25, sourceKey: "wake_county_absentee_owners" },
  { label: "Beaufort Absentee", county: "Beaufort", city: "Washington", limit: 25, sourceKey: "beaufort_county_absentee_owners" },
  { label: "Granville Absentee", county: "Granville", city: "Oxford", limit: 25, sourceKey: "granville_county_absentee_owners" },
  { label: "Sampson Absentee", county: "Sampson", city: "Clinton", limit: 25, sourceKey: "sampson_county_absentee_owners" },
  { label: "Stokes Absentee", county: "Stokes", city: "Danbury", limit: 25, sourceKey: "stokes_county_absentee_owners" },
  { label: "Stanly Absentee", county: "Stanly", city: "Albemarle", limit: 25, sourceKey: "stanly_county_absentee_owners" },
  { label: "Wilkes Absentee", county: "Wilkes", city: "Wilkesboro", limit: 25, sourceKey: "wilkes_county_absentee_owners" },
  { label: "Warren Absentee", county: "Warren", city: "Warrenton", limit: 25, sourceKey: "warren_county_absentee_owners" },
  { label: "Robeson Absentee", county: "Robeson", city: "Lumberton", limit: 25, sourceKey: "robeson_county_absentee_owners" },
  { label: "Rockingham Absentee", county: "Rockingham", city: "Reidsville", limit: 25, sourceKey: "rockingham_county_absentee_owners" },
  { label: "Orange Absentee", county: "Orange", city: "Hillsborough", limit: 25, sourceKey: "orange_county_absentee_owners" },
  { label: "Nash Absentee", county: "Nash", city: "Rocky Mount", limit: 25, sourceKey: "nash_county_absentee_owners" },
  { label: "Edgecombe Absentee", county: "Edgecombe", city: "Tarboro", limit: 25, sourceKey: "edgecombe_county_absentee_owners" },
  { label: "Ashe Absentee", county: "Ashe", city: "Jefferson", limit: 25, sourceKey: "ashe_county_absentee_owners" },
  { label: "Avery Absentee", county: "Avery", city: "Newland", limit: 25, sourceKey: "avery_county_absentee_owners" },
  { label: "Burke Absentee", county: "Burke", city: "Morganton", limit: 25, sourceKey: "burke_county_absentee_owners" },
  { label: "Forsyth Foreclosures", county: "Forsyth", city: "Winston-Salem", limit: 25, sourceKey: "forsyth_county_foreclosure_sales" },
  { label: "Guilford Foreclosures", county: "Guilford", city: "Greensboro", limit: 25, sourceKey: "guilford_county_foreclosure_research" },
  { label: "Mecklenburg Foreclosures", county: "Mecklenburg", city: "Charlotte", limit: 25, sourceKey: "mecklenburg_county_foreclosure_properties" },
  { label: "Mecklenburg Delinquent", county: "Mecklenburg", city: "Charlotte", limit: 25, sourceKey: "mecklenburg_county_delinquent_taxpayers" },
  { label: "Cumberland Foreclosures", county: "Cumberland", city: "Fayetteville", limit: 25, sourceKey: "cumberland_county_foreclosure_sales" },
  { label: "Cumberland Delinquent", county: "Cumberland", city: "Fayetteville", limit: 25, sourceKey: "cumberland_county_delinquent_taxes" },
  { label: "Statewide High-Value", county: "Mecklenburg", city: "", limit: 25, sourceKey: "nc_onemap_high_value_absentee_search" },
];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function scoreTone(score: number) {
  if (score >= 80) return "seller-score-hot";
  if (score >= 60) return "seller-score-warm";
  if (score >= 40) return "seller-score-watch";
  return "seller-score-low";
}

function boolPill(active: boolean, label: string) {
  return active ? <span className="seller-signal">{label}</span> : null;
}

export function SellerEngineDashboard({ initialLeads, alerts, sources }: { initialLeads: SellerLeadView[]; alerts: AlertRow[]; sources: SourceRow[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [selected, setSelected] = useState<SellerLeadView | null>(initialLeads[0] ?? null);
  const [sourceList, setSourceList] = useState(sources);
  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [weights, setWeights] = useState<SellerScoringWeights>(DEFAULT_SELLER_SCORING_WEIGHTS);
  const [liveSourceKey, setLiveSourceKey] = useState(SELLER_LIVE_SOURCES[0]?.key ?? "");
  const [liveCounty, setLiveCounty] = useState("Mecklenburg");
  const [liveCity, setLiveCity] = useState("");
  const [liveLimit, setLiveLimit] = useState("25");
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const selectedLiveSource = SELLER_LIVE_SOURCES.find((source) => source.key === liveSourceKey) ?? SELLER_LIVE_SOURCES[0];
  const [renderedAt] = useState(() => Date.now());

  const filtered = leads.filter((lead) => {
    const haystack = `${lead.ownerName} ${lead.propertyAddress} ${lead.city} ${lead.zipCode} ${lead.parcelId}`.toLowerCase();
    return (!deferredQuery || haystack.includes(deferredQuery)) && (!county || lead.county === county) && (!status || lead.status === status) && (!category || lead.category === category);
  });
  const counties = [...new Set(leads.map((lead) => lead.county))].sort();
  const sourceMetrics = {
    total: sourceList.length,
    active: sourceList.filter((source) => source.active).length,
    countyCount: new Set(sourceList.map((source) => source.county || "Statewide")).size,
    starterPack: sourceList.filter((source) => source.configuration?.starterPack).length,
  };
  const metrics = {
    total: leads.length,
    hot: leads.filter((lead) => lead.score >= 80).length,
    newWeek: leads.filter((lead) => renderedAt - Date.parse(lead.importedAt) < 7 * 86400000).length,
    foreclosure: leads.filter((lead) => lead.signals.foreclosure).length,
    probate: leads.filter((lead) => lead.signals.probate).length,
    tax: leads.filter((lead) => lead.signals.taxDelinquent).length,
    absentee: leads.filter((lead) => lead.signals.absenteeOwner).length,
    watchlist: leads.filter((lead) => lead.status === "Watchlist" || lead.category === "Watchlist").length,
  };

  async function updateLead(lead: SellerLeadView, patch: { status?: SellerLeadStatus; note?: string; markDuplicate?: boolean }) {
    const response = await fetch("/api/seller-engine/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lead.id, ...patch }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Lead update failed.");
    if (patch.status) {
      const next = { ...lead, status: patch.status };
      setLeads((current) => current.map((item) => item.id === lead.id ? next : item));
      setSelected(next);
    }
    setMessage("Lead intelligence record updated.");
  }

  async function uploadCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await fetch("/api/seller-engine/import", { method: "POST", body: new FormData(form) });
    const payload = await response.json();
    setMessage(response.ok ? `Imported ${payload.imported} of ${payload.total} seller records.` : payload.error);
    if (response.ok) {
      const refreshed = await fetch("/api/seller-engine/leads").then((item) => item.json());
      if (refreshed.ok) setLeads(refreshed.leads);
      const refreshedSources = await fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null);
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources);
    }
  }

  async function runLiveSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Running live county search...");
    const response = await fetch("/api/seller-engine/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceKey: liveSourceKey,
        county: liveCounty,
        city: liveCity,
        limit: Number(liveLimit || 25),
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `Live search imported ${payload.imported} of ${payload.total} seller records.` : payload.error);
    if (response.ok) {
      const [refreshedLeads, refreshedSources] = await Promise.all([
        fetch("/api/seller-engine/leads").then((item) => item.json()).catch(() => null),
        fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null),
      ]);
      if (refreshedLeads?.ok) {
        setLeads(refreshedLeads.leads);
        setSelected(refreshedLeads.leads[0] ?? null);
      }
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources);
    }
  }

  function applyLivePreset(preset: typeof LIVE_SEARCH_PRESETS[number]) {
    setLiveSourceKey(preset.sourceKey);
    setLiveCounty(preset.county);
    setLiveCity(preset.city);
    setLiveLimit(String(preset.limit));
    setMessage(`Preset loaded: ${preset.label}`);
  }

  async function saveWeights() {
    const response = await fetch("/api/seller-engine/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(weights) });
    const payload = await response.json();
    setMessage(response.ok ? "Scoring weights saved. Future imports will use this model." : payload.error);
  }

  async function generateSummary() {
    if (!selected) return;
    setMessage("Generating seller intelligence summary...");
    const response = await fetch("/api/seller-engine/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error);
    const next = { ...selected, summary: payload.summary };
    setSelected(next);
    setLeads((current) => current.map((lead) => lead.id === next.id ? next : lead));
    setMessage("Seller intelligence summary generated.");
  }

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/seller-engine/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const payload = await response.json();
    setMessage(response.ok ? "County source configuration saved." : payload.error);
    if (response.ok) {
      const refreshedSources = await fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null);
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources);
      form.reset();
    }
  }

  async function bootstrapStarterPack() {
    setMessage("Loading seller county starter pack...");
    const response = await fetch("/api/seller-engine/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bootstrap_starter_pack" }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `Loaded ${payload.sourceCount} starter sources across ${payload.counties.length} counties.` : payload.error);
    if (response.ok) {
      const refreshedSources = await fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null);
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources);
    }
  }

  async function toggleSource(source: SourceRow) {
    const response = await fetch("/api/seller-engine/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, active: !source.active }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `${source.name} ${source.active ? "deactivated" : "activated"}.` : payload.error);
    if (response.ok) {
      setSourceList((current) =>
        current.map((item) => item.id === source.id ? { ...item, active: !item.active } : item),
      );
    }
  }

  return (
    <>
      <header className="seller-panel seller-hero overflow-hidden p-6 lg:p-8">
        <div className="relative grid gap-7 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.44em] text-[var(--seller-silver)]">Motivated seller intelligence</p>
            <h2 className="brand-display mt-4 max-w-4xl text-5xl leading-[0.98] text-white lg:text-7xl">
              Find the pressure.<br /><span className="seller-accent-text">Qualify the seller.</span>
            </h2>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              Aggregate public records, score motivation signals, and turn scattered county data into a clean Qualified Seller Lead ready for the Deal Engine.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#harvester" className="seller-button">Import county data</a>
              <a href="#leads" className="seller-button">Review ranked leads</a>
              <Link href="/workspace/deal-engine" className="seller-button">Open Deal Engine</Link>
              <a href="/api/seller-engine/export" className="seller-button">Export qualified leads</a>
            </div>
          </div>
          <div className="seller-card grid content-center gap-4 p-5">
            <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--seller-gold)]">Signal constellation</div>
            {[
              ["Distress coverage", `${metrics.foreclosure + metrics.probate + metrics.tax} signals`],
              ["Highest priority", `${metrics.hot} hot leads`],
              ["Pipeline posture", `${metrics.newWeek} new this week`],
            ].map(([label, value]) => (
              <div key={label} className="border-l border-[var(--seller-line-strong)] pl-4">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--copy-muted)]">{label}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {message ? <div className="seller-card border-[var(--seller-line-strong)] px-5 py-4 text-sm text-[var(--seller-gold-soft)]">{message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total leads", metrics.total], ["Hot leads", metrics.hot], ["New this week", metrics.newWeek], ["Foreclosure", metrics.foreclosure],
          ["Probate", metrics.probate], ["Tax delinquent", metrics.tax], ["Absentee owners", metrics.absentee], ["Watchlist", metrics.watchlist],
        ].map(([label, value]) => <div key={label} className="seller-card p-4"><div className="text-[10px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">{label}</div><div className="seller-accent-text mt-2 text-3xl font-semibold">{value}</div></div>)}
      </section>

      <section id="leads" className="seller-panel p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="seller-kicker">Qualified seller leads</p><h3 className="mt-2 text-2xl font-semibold text-white">Ranked motivation pipeline</h3></div>
          <div className="text-sm text-[var(--copy-muted)]">{filtered.length} of {leads.length} visible</div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input className="seller-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search owner, address, parcel..." />
          <select className="seller-input" value={county} onChange={(event) => setCounty(event.target.value)}><option value="">All counties</option>{counties.map((item) => <option key={item}>{item}</option>)}</select>
          <select className="seller-input" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All score bands</option>{["Hot Lead", "Warm Lead", "Watchlist", "Low Priority"].map((item) => <option key={item}>{item}</option>)}</select>
          <select className="seller-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{SELLER_LEAD_STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="mt-5 overflow-x-auto rounded-[20px] border border-[var(--seller-line)]">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[hsl(214_22%_7%/.96)] text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">
              <tr>{["Score", "Owner / Property", "Location", "Signals", "Equity", "Status", "Action"].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr>
            </thead>
            <tbody>{filtered.map((lead) => (
              <tr key={lead.id} className="border-t border-[var(--seller-line)] bg-[hsl(215_20%_5%/.82)] hover:bg-[hsl(42_70%_12%/.28)]">
                <td className="px-4 py-4"><button onClick={() => setSelected(lead)} className={`seller-score ${scoreTone(lead.score)}`}>{lead.score}</button><div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">{lead.category}</div></td>
                <td className="px-4 py-4"><button onClick={() => setSelected(lead)} className="text-left"><div className="font-semibold text-white">{lead.ownerName}</div><div className="mt-1 text-xs text-[var(--copy-soft)]">{lead.propertyAddress}</div></button></td>
                <td className="px-4 py-4 text-[var(--copy-soft)]">{lead.city}, {lead.county}<div className="mt-1 text-xs text-[var(--copy-muted)]">{lead.zipCode}</div></td>
                <td className="px-4 py-4"><div className="flex max-w-[260px] flex-wrap gap-1">{boolPill(lead.signals.foreclosure, "Foreclosure")}{boolPill(lead.signals.probate, "Probate")}{boolPill(lead.signals.taxDelinquent, "Tax")}{boolPill(lead.signals.absenteeOwner, "Absentee")}{boolPill(lead.signals.vacant, "Vacant")}{boolPill(lead.signals.codeViolation, "Code")}</div></td>
                <td className="px-4 py-4 font-mono text-[var(--seller-gold-soft)]">{money.format(lead.estimatedEquity)}</td>
                <td className="px-4 py-4"><select className="seller-input min-w-[170px] py-2" value={lead.status} onChange={(event) => updateLead(lead, { status: event.target.value as SellerLeadStatus })}>{SELLER_LEAD_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></td>
                <td className="px-4 py-4"><button className="seller-button py-2" onClick={() => setSelected(lead)}>Open dossier</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {selected ? <section className="seller-panel p-5 lg:p-6">
        <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          <div className="seller-card p-5">
            <div className="flex items-start justify-between gap-4"><div><p className="seller-kicker">Seller dossier</p><h3 className="mt-2 text-2xl font-semibold text-white">{selected.ownerName}</h3></div><div className={`seller-score ${scoreTone(selected.score)}`}>{selected.score}</div></div>
            <dl className="mt-5 space-y-4 text-sm">{[
              ["Property", selected.propertyAddress], ["Mailing address", selected.ownerMailingAddress], ["Parcel", selected.parcelId], ["Ownership length", `${selected.yearsOwned} years`], ["Assessed value", money.format(selected.assessedValue)], ["Estimated equity", money.format(selected.estimatedEquity)], ["Source", selected.sourceName],
            ].map(([label, value]) => <div key={label} className="border-b border-[var(--seller-line)] pb-3"><dt className="text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">{label}</dt><dd className="mt-1 text-[var(--copy-soft)]">{value}</dd></div>)}</dl>
          </div>
          <div className="space-y-4">
            <div className="seller-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="seller-kicker">AI intelligence brief</p><button className="seller-button py-2" onClick={generateSummary}>Generate AI brief</button></div><p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{selected.summary}</p></div>
            <div className="seller-card p-5"><p className="seller-kicker">Motivation reasons</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{selected.reasons.map((reason) => <div key={reason} className="rounded-[14px] border border-[var(--seller-line)] px-3 py-3 text-sm text-[var(--copy-soft)]">{reason}</div>)}</div></div>
            <div className="seller-card p-5"><p className="seller-kicker">Recommended contact strategy</p><p className="mt-3 text-sm leading-7 text-white">{selected.recommendedAction}</p><div className="mt-5 flex flex-wrap gap-2"><button className="seller-button" onClick={() => updateLead(selected, { status: "Contact Ready" })}>Mark Contact Ready</button><button className="seller-button" onClick={() => updateLead(selected, { status: "Sent to Deal Engine" })}>Send to Deal Engine</button><Link className="seller-button" href="/workspace/deal-engine">Open Deal Engine</Link><button className="seller-button" onClick={() => updateLead(selected, { status: "Watchlist" })}>Add to Watchlist</button><button className="seller-button" onClick={() => updateLead(selected, { markDuplicate: true })}>Mark Duplicate</button></div></div>
          </div>
        </div>
      </section> : null}

      <section id="harvester" className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={runLiveSearch} className="seller-panel p-5 lg:p-6">
          <p className="seller-kicker">Live county search</p><h3 className="mt-2 text-2xl font-semibold text-white">Pull live seller data on demand</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
            This search hits the selected live county or statewide source when an operator initiates a run, then scores and imports the records into Seller Engine.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <select
              name="liveSourceKey"
              className="seller-input"
              value={liveSourceKey}
              onChange={(event) => setLiveSourceKey(event.target.value as SellerLiveSourceKey)}
            >
              {SELLER_LIVE_SOURCES.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
            </select>
            <input name="liveCounty" className="seller-input" placeholder="County" value={liveCounty} onChange={(event) => setLiveCounty(event.target.value)} required />
            <input name="liveCity" className="seller-input" placeholder="City (optional)" value={liveCity} onChange={(event) => setLiveCity(event.target.value)} />
            <input name="liveLimit" type="number" min="1" max="100" value={liveLimit} onChange={(event) => setLiveLimit(event.target.value)} className="seller-input md:col-span-3 xl:col-span-1" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {LIVE_SEARCH_PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="seller-button py-2" onClick={() => applyLivePreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[var(--copy-muted)]">
            <span className="seller-signal">{selectedLiveSource?.label}</span>
            <span className="seller-signal">{selectedLiveSource?.description}</span>
          </div>
          <button className="seller-button mt-5 w-full justify-center" type="submit">Run live seller search</button>
        </form>

        <form onSubmit={uploadCsv} className="seller-panel p-5 lg:p-6">
          <p className="seller-kicker">Data harvester</p><h3 className="mt-2 text-2xl font-semibold text-white">Import public-record CSV</h3>
          <div className="mt-5 space-y-3"><input name="sourceName" className="seller-input" placeholder="Source name, e.g. Forsyth Tax Delinquent List" required /><select name="sourceType" className="seller-input">{SELLER_SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}</select><input name="county" className="seller-input" placeholder="County" /><input name="file" type="file" accept=".csv,text/csv" className="seller-input" required /><button className="seller-button w-full justify-center" type="submit">Score and import leads</button></div>
          <a className="mt-4 inline-block text-xs text-[var(--seller-silver)] underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(sellerCsvTemplate())}`} download="seller-engine-template.csv">Download CSV template</a>
        </form>
        <div className="seller-panel p-5 lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="seller-kicker">Source registry</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Configured county sources</h3>
            </div>
            <button type="button" className="seller-button py-2" onClick={bootstrapStarterPack}>Load county starter pack</button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[["Sources", sourceMetrics.total], ["Active", sourceMetrics.active], ["Counties", sourceMetrics.countyCount], ["Starter pack", sourceMetrics.starterPack]].map(([label, value]) => (
              <div key={label} className="seller-card p-4">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-3">
            {sourceList.length ? sourceList.map((source) => (
              <div key={source.id} className="seller-card grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="font-semibold text-white">{source.name}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{source.county || "Statewide"} · {source.source_type} · {source.integration_type}</div>
                  {source.configuration?.notes ? <div className="mt-2 text-xs leading-5 text-[var(--copy-soft)]">{source.configuration.notes}</div> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="seller-signal h-fit">{source.active ? "Active" : "Inactive"}</span>
                  <button type="button" className="seller-button py-2" onClick={() => toggleSource(source)}>{source.active ? "Deactivate" : "Activate"}</button>
                </div>
              </div>
            )) : <div className="seller-card p-4 text-sm leading-6 text-[var(--copy-soft)]">No persisted sources yet. Uploading the first CSV creates the first source configuration. Live search runs will register their source automatically.</div>}
          </div>
        </div>
      </section>

      <form onSubmit={addSource} className="seller-panel p-5 lg:p-6">
        <p className="seller-kicker">Manual source configuration</p><h3 className="mt-2 text-2xl font-semibold text-white">Register a county data source</h3>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5"><input name="name" className="seller-input" placeholder="Source name" required /><input name="county" className="seller-input" placeholder="County or statewide" /><select name="sourceType" className="seller-input">{SELLER_SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}</select><input name="sourceUrl" className="seller-input" placeholder="Public source URL" /><button className="seller-button justify-center" type="submit">Save source</button></div>
      </form>

      <section id="alerts" className="seller-panel p-5 lg:p-6"><p className="seller-kicker">In-app alerts</p><h3 className="mt-2 text-2xl font-semibold text-white">New motivation signals</h3><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{alerts.map((alert) => <div key={alert.id} className="seller-card p-4"><div className="text-[10px] uppercase tracking-[0.24em] text-[var(--seller-silver)]">{alert.alert_type.replaceAll("_", " ")}</div><div className="mt-2 font-semibold text-white">{alert.title}</div><p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{alert.message}</p></div>)}</div></section>

      <section id="settings" className="seller-panel p-5 lg:p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="seller-kicker">Admin settings</p><h3 className="mt-2 text-2xl font-semibold text-white">Motivation scoring weights</h3></div><button className="seller-button" onClick={saveWeights}>Save scoring model</button></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">{Object.entries(weights).map(([key, value]) => <label key={key} className="seller-card p-4"><span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">{key.replace(/([A-Z])/g, " $1")}</span><input className="seller-input mt-3" type="number" min="0" max="100" value={value} onChange={(event) => setWeights((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></section>
    </>
  );
}
