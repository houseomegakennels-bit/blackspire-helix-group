"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState, type FormEvent } from "react";

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

type AlertRow = {
  id: string;
  title: string;
  message: string;
  alert_type: string;
  read: boolean;
  created_at: string;
};

type SourceRow = {
  id: string;
  name: string;
  county?: string | null;
  state?: string | null;
  source_type: string;
  integration_type: string;
  source_url?: string | null;
  active: boolean;
  last_imported_at?: string | null;
  configuration?: {
    notes?: string;
    starterPack?: boolean;
    buyerRegistry?: boolean;
    blendedSourceKeys?: string[];
    blendedSourceTypes?: string[];
    health?: {
      status?: string;
      checkedAt?: string;
      detail?: string;
      httpStatus?: number;
      resolvedUrl?: string | null;
    };
  } | null;
};

type CoverageRow = {
  county: string;
  activeCount: number;
  sourceCount: number;
  healthyCount: number;
  degradedCount: number;
  sourceTypes: string[];
  distressTypes: string[];
  integrations: string[];
  gaps: string[];
  coverageMode: string;
};

const DISTRESS_SOURCE_TYPES = new Set([
  "foreclosure",
  "tax_delinquent",
  "probate",
  "code_violation",
  "vacancy",
  "public_auction",
]);

const LIVE_SEARCH_PRESETS: Array<{
  label: string;
  county: string;
  city: string;
  limit: number;
  sourceKey: SellerLiveSourceKey;
}> = [
  { label: "Charlotte Distress Blend", county: "Mecklenburg", city: "Charlotte", limit: 25, sourceKey: "county_distress_blend" },
  { label: "Fayetteville Distress Blend", county: "Cumberland", city: "Fayetteville", limit: 25, sourceKey: "county_distress_blend" },
  { label: "Charlotte Operational Blend", county: "Mecklenburg", city: "Charlotte", limit: 25, sourceKey: "county_operational_blend" },
  { label: "Raleigh Operational Blend", county: "Wake", city: "Raleigh", limit: 25, sourceKey: "county_operational_blend" },
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

function formatSourceType(value: string | undefined) {
  return (value ?? "unknown").replaceAll("_", " ");
}

function formatHealthStatus(value: string | undefined) {
  return (value ?? "unknown").replaceAll("_", " ");
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "Not recorded";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function buildSellerContactWorkflow(lead: SellerLeadView) {
  const hasPhone = Boolean(lead.ownerPhone?.trim());
  return [
    {
      title: "Check the source for direct contact data",
      detail: `Review ${lead.sourceName} and any imported notes to see whether a usable seller number already exists.`,
      status: hasPhone ? "Ready" : "Active",
    },
    {
      title: hasPhone ? "Verify the best number" : "Run skip trace and verify the best number",
      detail: hasPhone
        ? "A phone is attached. Confirm it is current, mobile-capable, and approved for outreach."
        : "No phone is stored. Pull contact enrichment, verify the best number, and document the source.",
      status: "Active",
    },
    {
      title: "Confirm compliance and decision-maker posture",
      detail: "Check DNC / opt-out posture and note any family, probate, or title-sensitive handling before contact.",
      status: "Ready",
    },
    {
      title: "Open Seller Outreach Draft Command and log the outcome",
      detail: "Once the number is verified, send the first-touch script and capture the response, voicemail, or no-answer result.",
      status: hasPhone ? "Ready" : "Blocked",
    },
  ];
}

function buildCoverageRows(sourceList: SourceRow[]): CoverageRow[] {
  const grouped = new Map<string, CoverageRow>();
  for (const source of sourceList) {
    const county = source.county || "Statewide";
    const existing = grouped.get(county) ?? {
      county,
      activeCount: 0,
      sourceCount: 0,
      healthyCount: 0,
      degradedCount: 0,
      sourceTypes: [],
      distressTypes: [],
      integrations: [],
      gaps: [],
      coverageMode: "Registry Only",
    };
    existing.sourceCount += 1;
    if (source.active) existing.activeCount += 1;
    if (!existing.sourceTypes.includes(source.source_type)) existing.sourceTypes.push(source.source_type);
    if (DISTRESS_SOURCE_TYPES.has(source.source_type) && !existing.distressTypes.includes(source.source_type)) {
      existing.distressTypes.push(source.source_type);
    }
    for (const blendedType of source.configuration?.blendedSourceTypes ?? []) {
      if (!existing.sourceTypes.includes(blendedType)) existing.sourceTypes.push(blendedType);
      if (DISTRESS_SOURCE_TYPES.has(blendedType) && !existing.distressTypes.includes(blendedType)) {
        existing.distressTypes.push(blendedType);
      }
    }
    if (!existing.integrations.includes(source.integration_type)) existing.integrations.push(source.integration_type);
    const health = source.configuration?.health?.status;
    if (health === "healthy") existing.healthyCount += 1;
    if (health === "degraded" || health === "down" || health === "missing_url") existing.degradedCount += 1;
    grouped.set(county, existing);
  }

  return [...grouped.values()].map((row) => {
    const sourceTypes = new Set(row.sourceTypes);
    row.gaps = [
      sourceTypes.has("absentee_owner") ? null : "absentee_owner",
      sourceTypes.has("foreclosure") ? null : "foreclosure",
      sourceTypes.has("tax_delinquent") ? null : "tax_delinquent",
      sourceTypes.has("probate") ? null : "probate",
    ].filter(Boolean) as string[];
    row.coverageMode = row.distressTypes.length && sourceTypes.has("absentee_owner")
      ? "Operational Blend Ready"
      : row.distressTypes.length
        ? "Distress Partial"
        : sourceTypes.has("absentee_owner")
          ? "Absentee Only"
          : "Registry Only";
    return row;
  }).sort((left, right) => {
    if (left.county === "Statewide") return 1;
    if (right.county === "Statewide") return -1;
    return left.county.localeCompare(right.county);
  });
}

export function SellerEngineDashboard({
  initialLeads,
  alerts,
  sources,
}: {
  initialLeads: SellerLeadView[];
  alerts: AlertRow[];
  sources: SourceRow[];
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [selected, setSelected] = useState<SellerLeadView | null>(initialLeads[0] ?? null);
  const [sourceList, setSourceList] = useState(sources);
  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [leadType, setLeadType] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [importedRange, setImportedRange] = useState("");
  const [message, setMessage] = useState("");
  const [weights, setWeights] = useState<SellerScoringWeights>(DEFAULT_SELLER_SCORING_WEIGHTS);
  const [liveSourceKey, setLiveSourceKey] = useState(SELLER_LIVE_SOURCES[0]?.key ?? "");
  const [liveCounty, setLiveCounty] = useState("Mecklenburg");
  const [liveCity, setLiveCity] = useState("");
  const [liveLimit, setLiveLimit] = useState("25");
  const [noteDraft, setNoteDraft] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [dealLoading, setDealLoading] = useState(false);
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const selectedLiveSource = SELLER_LIVE_SOURCES.find((source) => source.key === liveSourceKey) ?? SELLER_LIVE_SOURCES[0];
  const [renderedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!selected?.id) return;
    if (selected.notes?.length || selected.statusHistory?.length || selected.relatedDealId) return;
    void hydrateLeadDetail(selected.id, false);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = leads.filter((lead) => {
    const haystack = `${lead.ownerName} ${lead.propertyAddress} ${lead.city} ${lead.zipCode} ${lead.parcelId}`.toLowerCase();
    const importedAgeDays = (renderedAt - Date.parse(lead.importedAt)) / 86400000;
    return (
      (!deferredQuery || haystack.includes(deferredQuery)) &&
      (!county || lead.county === county) &&
      (!status || lead.status === status) &&
      (!category || lead.category === category) &&
      (!city || lead.city === city) &&
      (!zip || lead.zipCode === zip) &&
      (!propertyType || lead.propertyType === propertyType) &&
      (!leadType || lead.sourceType === leadType) &&
      (!occupancy || (lead.ownerOccupancyStatus ?? "Unknown") === occupancy) &&
      (!importedRange || importedAgeDays <= Number(importedRange))
    );
  });

  const counties = [...new Set(leads.map((lead) => lead.county))].sort();
  const cities = [...new Set(leads.map((lead) => lead.city).filter(Boolean))].sort();
  const zipCodes = [...new Set(leads.map((lead) => lead.zipCode).filter(Boolean))].sort();
  const propertyTypes = [...new Set(leads.map((lead) => lead.propertyType).filter(Boolean))].sort();
  const leadTypes = [...new Set(leads.map((lead) => lead.sourceType).filter(Boolean) as string[])].sort();
  const occupancies = [...new Set(leads.map((lead) => lead.ownerOccupancyStatus ?? "Unknown"))].sort();
  const coverageRows = buildCoverageRows(sourceList);
  const selectedContactWorkflow = selected ? buildSellerContactWorkflow(selected) : [];

  const sourceMetrics = {
    total: sourceList.length,
    active: sourceList.filter((source) => source.active).length,
    countyCount: new Set(sourceList.map((source) => source.county || "Statewide")).size,
    starterPack: sourceList.filter((source) => source.configuration?.starterPack).length,
    distressReady: coverageRows.filter((row) => row.distressTypes.length > 0).length,
    registryBacked: sourceList.filter((source) => source.configuration?.buyerRegistry).length,
    healthy: sourceList.filter((source) => source.configuration?.health?.status === "healthy").length,
    degraded: sourceList.filter((source) => {
      const status = source.configuration?.health?.status;
      return status === "degraded" || status === "down" || status === "missing_url";
    }).length,
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

  async function hydrateLeadDetail(id: string, announce = true) {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/seller-engine/leads?id=${encodeURIComponent(id)}`);
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.lead) {
        throw new Error(payload.error ?? "Lead detail fetch failed.");
      }

      const detail = payload.lead as SellerLeadView;
      setLeads((current) => current.map((lead) => (lead.id === detail.id ? { ...lead, ...detail } : lead)));
      setSelected((current) => (current?.id === detail.id ? detail : current));
      if (announce) setMessage("Seller dossier refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lead detail fetch failed.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshLeadsAndSources(preferredLeadId?: string | null) {
    const [refreshedLeads, refreshedSources] = await Promise.all([
      fetch("/api/seller-engine/leads").then((item) => item.json()).catch(() => null),
      fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null),
    ]);

    if (refreshedLeads?.ok) {
      const nextLeads = refreshedLeads.leads as SellerLeadView[];
      setLeads(nextLeads);
      const nextSelectedId = preferredLeadId ?? selected?.id ?? nextLeads[0]?.id ?? null;
      const nextSelected = nextLeads.find((lead) => lead.id === nextSelectedId) ?? nextLeads[0] ?? null;
      setSelected(nextSelected);
      if (nextSelected?.id) {
        await hydrateLeadDetail(nextSelected.id, false);
      }
    }

    if (refreshedSources?.ok) {
      setSourceList(refreshedSources.sources as SourceRow[]);
    }
  }

  async function updateLead(lead: SellerLeadView, patch: { status?: SellerLeadStatus; note?: string; markDuplicate?: boolean }) {
    const response = await fetch("/api/seller-engine/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, ...patch }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Lead update failed.");
      return;
    }

    if (patch.status) {
      const nextStatus = patch.status;
      const nextLead = { ...lead, status: nextStatus };
      setLeads((current) => current.map((item) => (item.id === lead.id ? nextLead : item)));
      setSelected((current) => (current?.id === lead.id ? { ...current, status: nextStatus } : current));
    }

    if (patch.note) {
      setNoteDraft("");
    }

    await hydrateLeadDetail(lead.id, false);
    setMessage(
      patch.note
        ? "Lead note saved."
        : patch.markDuplicate
          ? "Lead marked as duplicate."
          : "Lead intelligence record updated.",
    );
  }

  async function uploadCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await fetch("/api/seller-engine/import", { method: "POST", body: new FormData(form) });
    const payload = await response.json();
    setMessage(response.ok ? `Imported ${payload.imported} of ${payload.total} seller records.` : payload.error);
    if (response.ok) {
      form.reset();
      await refreshLeadsAndSources();
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
      await refreshLeadsAndSources();
    }
  }

  function applyLivePreset(preset: (typeof LIVE_SEARCH_PRESETS)[number]) {
    setLiveSourceKey(preset.sourceKey);
    setLiveCounty(preset.county);
    setLiveCity(preset.city);
    setLiveLimit(String(preset.limit));
    setMessage(`Preset loaded: ${preset.label}`);
  }

  async function saveWeights() {
    const response = await fetch("/api/seller-engine/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weights),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Scoring weights saved. Future imports will use this model." : payload.error);
  }

  async function generateSummary() {
    if (!selected) return;
    setMessage("Generating seller intelligence summary...");
    const response = await fetch("/api/seller-engine/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selected),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }

    const next = { ...selected, summary: payload.summary };
    setSelected(next);
    setLeads((current) => current.map((lead) => (lead.id === next.id ? next : lead)));
    setMessage("Seller intelligence summary generated.");
  }

  async function createDealFromSelectedLead() {
    if (!selected) return;
    setDealLoading(true);
    try {
      const response = await fetch("/api/deal-engine/create-from-seller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerLeadId: selected.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Deal Engine handoff failed.");
      }

      await refreshLeadsAndSources(selected.id);
      setMessage(payload.message ?? `Deal ${payload.dealId} created from Seller Engine.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deal Engine handoff failed.");
    } finally {
      setDealLoading(false);
    }
  }

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/seller-engine/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    setMessage(response.ok ? "County source configuration saved." : payload.error);
    if (response.ok) {
      form.reset();
      const refreshedSources = await fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null);
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources as SourceRow[]);
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
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources as SourceRow[]);
    }
  }

  async function syncBuyerRegistry() {
    setMessage("Syncing buyer county registry endpoints into Seller Engine...");
    const response = await fetch("/api/seller-engine/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_from_buyer_registry" }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `Synced ${payload.synced} registry-backed seller sources.` : payload.error);
    if (response.ok) {
      const refreshedSources = await fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null);
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources as SourceRow[]);
    }
  }

  async function probeSourceHealth(id?: string) {
    setMessage(id ? "Checking source health..." : "Running Seller Engine source health checks...");
    const response = await fetch("/api/seller-engine/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "probe_health", id }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `Health checked for ${payload.checked} seller sources.` : payload.error);
    if (response.ok) {
      const refreshedSources = await fetch("/api/seller-engine/sources").then((item) => item.json()).catch(() => null);
      if (refreshedSources?.ok) setSourceList(refreshedSources.sources as SourceRow[]);
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
      setSourceList((current) => current.map((item) => (item.id === source.id ? { ...item, active: !item.active } : item)));
    }
  }

  async function openLead(lead: SellerLeadView) {
    setSelected(lead);
    setNoteDraft("");
    await hydrateLeadDetail(lead.id, false);
  }

  async function openLeadAndJump(lead: SellerLeadView) {
    await openLead(lead);
    window.setTimeout(() => {
      document.getElementById("seller-dossier")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  return (
    <>
      <header className="seller-panel seller-hero overflow-hidden p-6 lg:p-8">
        <div className="relative grid gap-7 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.44em] text-[var(--seller-silver)]">Motivated seller intelligence</p>
            <h2 className="brand-display mt-4 max-w-4xl text-5xl leading-[0.98] text-white lg:text-7xl">
              Find the pressure.
              <br />
              <span className="seller-accent-text">Qualify the seller.</span>
            </h2>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              Aggregate public records, score motivation signals, and move qualified seller leads into a real operating pipeline ready for acquisition.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#harvester" className="seller-button">Import county data</a>
              <a href="#leads" className="seller-button">Review ranked leads</a>
              <a href="#seller-dossier" className="seller-button">Jump to dossier</a>
              <a href="#coverage" className="seller-button">Coverage board</a>
              <a href="/api/seller-engine/export" className="seller-button">Export qualified leads</a>
            </div>
          </div>
          <div className="seller-card grid content-center gap-4 p-5">
            <div className="text-[10px] uppercase tracking-[0.34em] text-[var(--seller-gold)]">Signal constellation</div>
            {[
              ["Distress coverage", `${metrics.foreclosure + metrics.probate + metrics.tax} signals`],
              ["Highest priority", `${metrics.hot} hot leads`],
              ["County footprint", `${sourceMetrics.distressReady} distress-ready counties`],
              ["Command mode", "Live-only / no demo fallback"],
            ].map(([label, value]) => (
              <div key={label} className="border-l border-[var(--seller-line-strong)] pl-4">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--copy-muted)]">{label}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {message ? (
        <div className="seller-card border-[var(--seller-line-strong)] px-5 py-4 text-sm text-[var(--seller-gold-soft)]">
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total leads", metrics.total],
          ["Hot leads", metrics.hot],
          ["New this week", metrics.newWeek],
          ["Foreclosure", metrics.foreclosure],
          ["Probate", metrics.probate],
          ["Tax delinquent", metrics.tax],
          ["Absentee owners", metrics.absentee],
          ["Watchlist", metrics.watchlist],
        ].map(([label, value]) => (
          <div key={label} className="seller-card p-4">
            <div className="text-[10px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">{label}</div>
            <div className="seller-accent-text mt-2 text-3xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section id="leads" className="seller-panel p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="seller-kicker">Qualified seller leads</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Ranked motivation pipeline</h3>
          </div>
          <div className="text-sm text-[var(--copy-muted)]">{filtered.length} of {leads.length} visible</div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input className="seller-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search owner, address, parcel..." />
          <select className="seller-input" value={county} onChange={(event) => setCounty(event.target.value)}>
            <option value="">All counties</option>
            {counties.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All score bands</option>
            {["Hot Lead", "Warm Lead", "Watchlist", "Low Priority"].map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {SELLER_LEAD_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={leadType} onChange={(event) => setLeadType(event.target.value)}>
            <option value="">All lead types</option>
            {leadTypes.map((item) => <option key={item} value={item}>{formatSourceType(item)}</option>)}
          </select>
          <select className="seller-input" value={occupancy} onChange={(event) => setOccupancy(event.target.value)}>
            <option value="">All occupancy</option>
            {occupancies.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={propertyType} onChange={(event) => setPropertyType(event.target.value)}>
            <option value="">All property types</option>
            {propertyTypes.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={city} onChange={(event) => setCity(event.target.value)}>
            <option value="">All cities</option>
            {cities.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={zip} onChange={(event) => setZip(event.target.value)}>
            <option value="">All zip codes</option>
            {zipCodes.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="seller-input" value={importedRange} onChange={(event) => setImportedRange(event.target.value)}>
            <option value="">All import dates</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>

        <div className="seller-card mt-5 grid gap-4 border-[var(--seller-line-strong)] p-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--seller-gold-soft)]">Dossier shortcut</div>
            <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Choose from the currently filtered leads and jump straight to the seller dossier without scrolling through the full table.
            </div>
            <select
              className="seller-input mt-3 w-full"
              value={selected?.id ?? ""}
              onChange={(event) => {
                const lead = leads.find((item) => item.id === event.target.value);
                if (lead) void openLeadAndJump(lead);
              }}
            >
              <option value="">Select a seller dossier...</option>
              {filtered.slice(0, 250).map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.ownerName} / {lead.propertyAddress} / score {lead.score}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="seller-button"
              disabled={!selected}
              onClick={() => selected ? void openLeadAndJump(selected) : undefined}
            >
              Jump to selected dossier
            </button>
            <a href="#seller-dossier" className="seller-button">Dossier section</a>
          </div>
        </div>

        <div className="seller-table-wrap mt-5 overflow-x-auto rounded-[20px] border border-[var(--seller-line)]">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="seller-table-head text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">
              <tr>{["Score", "Owner / Property", "Location", "Lead Type", "Signals", "Equity", "Status", "Action"].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id} className="seller-table-row border-t border-[var(--seller-line)]">
                  <td className="px-4 py-4">
                    <button onClick={() => void openLead(lead)} className={`seller-score ${scoreTone(lead.score)}`}>{lead.score}</button>
                    <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">{lead.category}</div>
                  </td>
                  <td className="px-4 py-4">
                    <button onClick={() => void openLead(lead)} className="text-left">
                      <div className="font-semibold text-white">{lead.ownerName}</div>
                      <div className="mt-1 text-xs text-[var(--copy-soft)]">{lead.propertyAddress}</div>
                    </button>
                  </td>
                  <td className="px-4 py-4 text-[var(--copy-soft)]">
                    {lead.city}, {lead.county}
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">{lead.zipCode}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-white">{formatSourceType(lead.sourceType)}</div>
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">{lead.ownerOccupancyStatus ?? "Unknown occupancy"}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {boolPill(lead.signals.foreclosure, "Foreclosure")}
                      {boolPill(lead.signals.probate, "Probate")}
                      {boolPill(lead.signals.taxDelinquent, "Tax")}
                      {boolPill(lead.signals.absenteeOwner, "Absentee")}
                      {boolPill(lead.signals.vacant, "Vacant")}
                      {boolPill(lead.signals.codeViolation, "Code")}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-[var(--seller-gold-soft)]">{money.format(lead.estimatedEquity)}</td>
                  <td className="px-4 py-4">
                    <select
                      className="seller-input min-w-[170px] py-2"
                      value={lead.status}
                      onChange={(event) => void updateLead(lead, { status: event.target.value as SellerLeadStatus })}
                    >
                      {SELLER_LEAD_STATUSES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-4">
                    <button className="seller-button py-2" onClick={() => void openLeadAndJump(lead)}>Open dossier</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!leads.length ? (
          <div className="seller-card mt-5 p-4 text-sm leading-6 text-[var(--copy-soft)]">
            No live seller leads are loaded yet. Seller Engine now stays in live-only mode, so this command deck remains empty until a county search or CSV import lands real records.
          </div>
        ) : null}
      </section>

      {selected ? (
        <section id="seller-dossier" className="seller-panel scroll-mt-6 p-5 lg:p-6">
          <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
            <div className="seller-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="seller-kicker">Seller dossier</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{selected.ownerName}</h3>
                </div>
                <div className={`seller-score ${scoreTone(selected.score)}`}>{selected.score}</div>
              </div>
              <dl className="mt-5 space-y-4 text-sm">
                {[
                  ["Property", selected.propertyAddress],
                  ["Mailing address", selected.ownerMailingAddress],
                  ["Seller phone", selected.ownerPhone ?? "Not captured"],
                  ["Phone status", selected.phoneStatus ?? "Skip Trace Needed"],
                  ["Phone source", selected.phoneSource ?? "Public record import"],
                  ["Parcel", selected.parcelId],
                  ["Lead type", formatSourceType(selected.sourceType)],
                  ["Owner occupancy", selected.ownerOccupancyStatus ?? "Unknown"],
                  ["Ownership length", `${selected.yearsOwned} years`],
                  ["Assessed value", money.format(selected.assessedValue)],
                  ["Estimated equity", money.format(selected.estimatedEquity)],
                  ["Source", selected.sourceName],
                  ["Imported", formatTimestamp(selected.importedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="border-b border-[var(--seller-line)] pb-3">
                    <dt className="text-[10px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">{label}</dt>
                    <dd className="mt-1 text-[var(--copy-soft)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="space-y-4">
              <div className="seller-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="seller-kicker">AI intelligence brief</p>
                  <button className="seller-button py-2" onClick={() => void generateSummary()}>Generate AI brief</button>
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{selected.summary}</p>
              </div>

              <div className="seller-card p-5">
                <p className="seller-kicker">Motivation reasons</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {selected.reasons.map((reason) => (
                    <div key={reason} className="rounded-[14px] border border-[var(--seller-line)] px-3 py-3 text-sm text-[var(--copy-soft)]">
                      {reason}
                    </div>
                  ))}
                </div>
              </div>

              <div className="seller-card p-5">
                <p className="seller-kicker">Recommended contact strategy</p>
                <p className="mt-3 text-sm leading-7 text-white">{selected.recommendedAction}</p>
                <div className="mt-4 rounded-[18px] border border-[var(--seller-line)] px-4 py-4 text-sm leading-7 text-[var(--copy-soft)]">
                  {selected.contactEnrichmentNotes ?? "No verified owner phone is stored yet. Treat contact enrichment and skip trace as part of the workflow before outreach."}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button className="seller-button" onClick={() => void updateLead(selected, { status: "Contact Ready" })}>Mark Contact Ready</button>
                  <Link className="seller-button" href="/workspace/nexus">
                    Open Nexus
                  </Link>
                  <button className="seller-button" disabled={dealLoading} onClick={() => void createDealFromSelectedLead()}>
                    {dealLoading ? "Bypassing..." : "Admin Bypass to Deal Engine"}
                  </button>
                  <Link className="seller-button" href={selected.relatedDealId ? `/workspace/deal-engine/${selected.relatedDealId}` : "/workspace/deal-engine"}>
                    {selected.relatedDealId ? "Open linked deal" : "Open Deal Engine"}
                  </Link>
                  <button className="seller-button" onClick={() => void updateLead(selected, { status: "Watchlist" })}>Add to Watchlist</button>
                  <button className="seller-button" onClick={() => void updateLead(selected, { markDuplicate: true })}>Mark Duplicate</button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="seller-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="seller-kicker">Seller Outreach Draft Command</p>
                    <span className="seller-signal">{selected.phoneStatus ?? "Skip Trace Needed"}</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedContactWorkflow.map((step) => (
                      <div key={step.title} className="rounded-[14px] border border-[var(--seller-line)] px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{step.title}</div>
                          <span className="seller-signal">{step.status}</span>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{step.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="seller-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="seller-kicker">Operator notes</p>
                    <span className="seller-signal">{selected.notes?.length ?? 0} notes</span>
                  </div>
                  <textarea
                    className="seller-input mt-4 min-h-[120px] w-full px-4 py-3"
                    placeholder="Capture owner nuance, title issues, contact attempts, or next-step reminders..."
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                  />
                  <button
                    className="seller-button mt-3"
                    disabled={!noteDraft.trim()}
                    onClick={() => void updateLead(selected, { note: noteDraft })}
                  >
                    Save note
                  </button>
                  <div className="mt-4 space-y-3">
                    {(selected.notes?.length ? selected.notes : []).map((note) => (
                      <div key={note.id} className="rounded-[14px] border border-[var(--seller-line)] px-3 py-3">
                        <div className="text-xs text-[var(--copy-muted)]">{formatTimestamp(note.createdAt)}</div>
                        <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{note.note}</div>
                      </div>
                    ))}
                    {!selected.notes?.length ? <div className="text-sm text-[var(--copy-muted)]">No operator notes yet.</div> : null}
                  </div>
                </div>

                <div className="seller-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="seller-kicker">Status history</p>
                    {detailLoading ? <span className="seller-signal">Refreshing</span> : null}
                  </div>
                  <div className="mt-4 space-y-3">
                    {(selected.statusHistory?.length ? selected.statusHistory : []).map((event) => (
                      <div key={event.id} className="rounded-[14px] border border-[var(--seller-line)] px-3 py-3">
                        <div className="text-xs text-[var(--copy-muted)]">{formatTimestamp(event.createdAt)}</div>
                        <div className="mt-2 text-sm text-white">
                          {event.fromStatus ? `${event.fromStatus} -> ${event.toStatus}` : event.toStatus}
                        </div>
                      </div>
                    ))}
                    {!selected.statusHistory?.length ? <div className="text-sm text-[var(--copy-muted)]">No status changes recorded yet.</div> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section id="harvester" className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={runLiveSearch} className="seller-panel p-5 lg:p-6">
          <p className="seller-kicker">Live county search</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Pull live seller data on demand</h3>
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
            {liveSourceKey === "county_distress_blend" ? <span className="seller-signal">Blends active distress feeds for this county</span> : null}
            {liveSourceKey === "county_operational_blend" ? <span className="seller-signal">Blends distress + absentee feeds for this county</span> : null}
          </div>
          <button className="seller-button mt-5 w-full justify-center" type="submit">Run live seller search</button>
        </form>

        <form onSubmit={uploadCsv} className="seller-panel p-5 lg:p-6">
          <p className="seller-kicker">Data harvester</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Import public-record CSV</h3>
          <div className="mt-5 space-y-3">
            <input name="sourceName" className="seller-input" placeholder="Source name, e.g. Forsyth Tax Delinquent List" required />
            <select name="sourceType" className="seller-input">{SELLER_SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}</select>
            <input name="county" className="seller-input" placeholder="County" />
            <input name="file" type="file" accept=".csv,text/csv" className="seller-input" required />
            <button className="seller-button w-full justify-center" type="submit">Score and import leads</button>
          </div>
          <a
            className="mt-4 inline-block text-xs text-[var(--seller-silver)] underline"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(sellerCsvTemplate())}`}
            download="seller-engine-template.csv"
          >
            Download CSV template
          </a>
        </form>

        <div className="seller-panel p-5 lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="seller-kicker">Source registry</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Configured county sources</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="seller-button py-2" onClick={() => void bootstrapStarterPack()}>Load county starter pack</button>
              <button type="button" className="seller-button py-2" onClick={() => void syncBuyerRegistry()}>Sync buyer registry</button>
              <button type="button" className="seller-button py-2" onClick={() => void probeSourceHealth()}>Run source health checks</button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              ["Sources", sourceMetrics.total],
              ["Active", sourceMetrics.active],
              ["Counties", sourceMetrics.countyCount],
              ["Distress ready", sourceMetrics.distressReady],
              ["Healthy", sourceMetrics.healthy],
              ["Degraded", sourceMetrics.degraded],
              ["Registry backed", sourceMetrics.registryBacked],
            ].map(([label, value]) => (
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
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">
                    {source.county || "Statewide"} · {formatSourceType(source.source_type)} · {source.integration_type}
                  </div>
                  {source.configuration?.notes ? <div className="mt-2 text-xs leading-5 text-[var(--copy-soft)]">{source.configuration.notes}</div> : null}
                  {source.last_imported_at ? <div className="mt-2 text-xs text-[var(--copy-muted)]">Last imported: {formatTimestamp(source.last_imported_at)}</div> : null}
                  {source.configuration?.health?.checkedAt ? (
                    <div className="mt-2 text-xs text-[var(--copy-muted)]">
                      Health: {formatHealthStatus(source.configuration.health.status)} · checked {formatTimestamp(source.configuration.health.checkedAt)}
                    </div>
                  ) : null}
                  {source.configuration?.health?.detail ? (
                    <div className="mt-2 text-xs leading-5 text-[var(--copy-soft)]">{source.configuration.health.detail}</div>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="seller-signal h-fit">{source.active ? "Active" : "Inactive"}</span>
                  <span className="seller-signal h-fit">{formatHealthStatus(source.configuration?.health?.status)}</span>
                  <button type="button" className="seller-button py-2" onClick={() => void probeSourceHealth(source.id)}>Check health</button>
                  <button type="button" className="seller-button py-2" onClick={() => void toggleSource(source)}>
                    {source.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            )) : <div className="seller-card p-4 text-sm leading-6 text-[var(--copy-soft)]">No persisted sources yet. Uploading the first CSV creates the first source configuration. Live search runs will register their source automatically.</div>}
          </div>
        </div>
      </section>

      <section id="coverage" className="seller-panel p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="seller-kicker">County coverage board</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Where Seller Engine is operational</h3>
          </div>
          <div className="text-sm text-[var(--copy-muted)]">{coverageRows.length} counties / regions tracked</div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {coverageRows.map((row) => (
            <div key={row.county} className="seller-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{row.county}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{row.activeCount} active / {row.sourceCount} total sources</div>
                </div>
                <span className="seller-signal">{row.coverageMode}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {row.sourceTypes.map((type) => (
                  <span key={type} className="seller-signal">{formatSourceType(type)}</span>
                ))}
              </div>
              <div className="mt-4 text-xs text-[var(--copy-muted)]">
                Integrations: {row.integrations.map((item) => item.replaceAll("_", " ")).join(", ")}
              </div>
              <div className="mt-3 text-xs text-[var(--copy-muted)]">
                Health: {row.healthyCount} healthy / {row.degradedCount} degraded
              </div>
              <div className="mt-3 text-xs text-[var(--copy-soft)]">
                Gaps: {row.gaps.length ? row.gaps.map((gap) => formatSourceType(gap)).join(", ") : "No primary signal gaps"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={addSource} className="seller-panel p-5 lg:p-6">
        <p className="seller-kicker">Manual source configuration</p>
        <h3 className="mt-2 text-2xl font-semibold text-white">Register a county data source</h3>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input name="name" className="seller-input" placeholder="Source name" required />
          <input name="county" className="seller-input" placeholder="County or statewide" />
          <select name="sourceType" className="seller-input">{SELLER_SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}</select>
          <input name="sourceUrl" className="seller-input" placeholder="Public source URL" />
          <button className="seller-button justify-center" type="submit">Save source</button>
        </div>
      </form>

      <section id="alerts" className="seller-panel p-5 lg:p-6">
        <p className="seller-kicker">In-app alerts</p>
        <h3 className="mt-2 text-2xl font-semibold text-white">New motivation signals</h3>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {alerts.length ? alerts.map((alert) => (
            <div key={alert.id} className="seller-card p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--seller-silver)]">{alert.alert_type.replaceAll("_", " ")}</div>
              <div className="mt-2 font-semibold text-white">{alert.title}</div>
              <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{alert.message}</p>
              <div className="mt-3 text-xs text-[var(--copy-muted)]">{formatTimestamp(alert.created_at)}</div>
            </div>
          )) : <div className="seller-card p-4 text-sm text-[var(--copy-soft)]">No alerts yet. Distress imports and hot-lead thresholds will populate this lane automatically.</div>}
        </div>
      </section>

      <section id="settings" className="seller-panel p-5 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="seller-kicker">Admin settings</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Motivation scoring weights</h3>
          </div>
          <button className="seller-button" onClick={() => void saveWeights()}>Save scoring model</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Object.entries(weights).map(([key, value]) => (
            <label key={key} className="seller-card p-4">
              <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--copy-muted)]">{key.replace(/([A-Z])/g, " $1")}</span>
              <input
                className="seller-input mt-3"
                type="number"
                min="0"
                max="100"
                value={value}
                onChange={(event) => setWeights((current) => ({ ...current, [key]: Number(event.target.value) }))}
              />
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
