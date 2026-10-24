"use client";

import { useEffect, useRef, useState } from "react";
import type { DealEngineDealDetail } from "@/lib/deal-engine-server";
import type { InvestmentInputs } from "@/lib/investment-analysis";
import { buildRecipientPacketPreview, compareResearchScenarios, researchMoney, validatePropertyResearch, type ComparableEvidence, type PacketAudience, type PropertyResearch, type ResearchSnapshot, type TitleEvidence } from "@/lib/property-research";
import { WorkspaceSaveState, useWorkspaceSaveState } from "@/components/workspace-save-state";

type Underwriting = DealEngineDealDetail["underwriting"];
export type ResearchTransport = { load: () => Promise<ResearchSnapshot>; save: (revision: number, research: PropertyResearch) => Promise<ResearchSnapshot> };
const field = "min-h-11 w-full min-w-0 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-base text-slate-900";
const button = "brand-button min-h-11 px-4 py-3 text-sm";
const sourceEmpty = { url: "", documentId: "", accessedOn: "" };
const inputFields = [["purchasePrice", "Purchase price"], ["resaleValue", "Resale value after repairs"], ["repairs", "Repairs"], ["closingCosts", "Closing costs"], ["holdingCosts", "Holding costs"], ["profitTarget", "Profit target"], ["assignmentFee", "Assignment fee"], ["monthlyRent", "Monthly rent"], ["monthlyExpenses", "Monthly operating expenses"], ["monthlyDebtService", "Monthly loan payment"]] as const;
function baseline(underwriting: Underwriting): InvestmentInputs {
  return { strategy: underwriting.strategy, purchasePrice: underwriting.sellerAskingPrice, resaleValue: underwriting.estimatedArv, repairs: underwriting.repairEstimate, closingCosts: underwriting.closingCosts, holdingCosts: underwriting.holdingCosts, profitTarget: underwriting.buyerProfitTarget, assignmentFee: underwriting.assignmentFeeTarget, monthlyRent: underwriting.rentalEstimate, monthlyExpenses: underwriting.monthlyExpenses, monthlyDebtService: underwriting.monthlyDebtService };
}

export function PropertyResearchWorkbench({ dealId, address, underwriting }: { dealId: string; address: string; underwriting: Underwriting }) {
  const [initial, setInitial] = useState<{ dealId: string; snapshot: ResearchSnapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/deal-engine/research?dealId=${encodeURIComponent(dealId)}`;
  async function load(): Promise<ResearchSnapshot> {
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Research could not be loaded.");
    return result.snapshot;
  }
  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Research could not be loaded.");
      if (active) setInitial({ dealId, snapshot: result.snapshot });
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Research is unavailable."); });
    return () => { active = false; };
  }, [url, dealId]);
  if (!initial || initial.dealId !== dealId) return <section className="brand-card p-5" aria-live="polite"><h3 className="text-xl font-semibold">Property research</h3><p className="mt-3">{error ?? "Loading saved research…"}</p>{error ? <button type="button" className={button + " mt-3"} onClick={() => { setError(null); load().then(snapshot => setInitial({ dealId, snapshot })).catch(reason => setError(reason.message)); }}>Try loading again</button> : null}</section>;
  const transport: ResearchTransport = { load, async save(expectedRevision, research) {
    const response = await fetch("/api/deal-engine/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealId, expectedRevision, research }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Research save could not be confirmed.");
    return result.snapshot;
  } };
  return <PropertyResearchEditor key={dealId} address={address} underwriting={underwriting} initial={initial.snapshot} transport={transport} />;
}

/** Shared editor: production uses the guarded API; synthetic previews supply an isolated transport. */
export function PropertyResearchEditor({ address, underwriting, initial, transport }: { address: string; underwriting: Underwriting; initial: ResearchSnapshot; transport: ResearchTransport }) {
  const [research, setResearchState] = useState(initial.research);
  const [duplicateIdsText, setDuplicateIdsText] = useState(initial.research.duplicateReview.candidateIds.join(", "));
  const duplicateIdsTextRef = useRef(initial.research.duplicateReview.candidateIds.join(", "));
  const currentDraftRef = useRef(initial.research);
  const revisionRef = useRef(initial.revision);
  const operationRef = useRef<"save" | "reload" | null>(null);
  const [reloading, setReloading] = useState(false);
  const [revision, setRevision] = useState(initial.revision);
  const [message, setMessage] = useState<string | null>(null);
  const [audience, setAudience] = useState<PacketAudience>("buyer");
  const saveState = useWorkspaceSaveState(research);
  function updateComp(id: string, patch: Partial<ComparableEvidence>) { setResearch(current => ({ ...current, comps: current.comps.map(item => item.id === id ? { ...item, ...patch } : item) })); }
  function updateTitle(id: string, patch: Partial<TitleEvidence>) { setResearch(current => ({ ...current, titleEvidence: current.titleEvidence.map(item => item.id === id ? { ...item, ...patch } : item) })); }
  function amount(value: string): number | null { return value.trim() === "" ? null : Number(value); }
  function setResearch(update: PropertyResearch | ((current: PropertyResearch) => PropertyResearch)) {
    const next = typeof update === "function" ? update(currentDraftRef.current) : update;
    currentDraftRef.current = next;
    setResearchState(next);
  }
  function updateDuplicateCandidateIds(value: string) {
    duplicateIdsTextRef.current = value;
    setDuplicateIdsText(value);
    setResearch(current => ({ ...current, duplicateReview: { ...current.duplicateReview, candidateIds: value.split(",").map(id => id.trim()).filter(Boolean) } }));
  }
  async function save() {
    if (operationRef.current) return;
    const submitted = saveState.begin();
    if (!submitted) return;
    operationRef.current = "save";
    const submittedRevision = revisionRef.current;
    setMessage(null);
    let validated: PropertyResearch;
    try { validated = validatePropertyResearch(JSON.parse(submitted)); }
    catch (error) { operationRef.current = null; saveState.fail(); setMessage(error instanceof Error ? error.message : "Review the research fields."); return; }
    try {
      const saved = await transport.save(submittedRevision, validated);
      revisionRef.current = saved.revision;
      setRevision(saved.revision); saveState.succeed(submitted);
      setMessage(`Research saved at revision ${saved.revision}. New edits made during saving remain unsaved.`);
    } catch (error) {
      // Reconcile a lost acknowledgement with a read, never a second automatic write.
      try {
        const observed = await transport.load();
        if (observed.revision === submittedRevision + 1 && JSON.stringify(observed.research) === JSON.stringify(validated)) {
          revisionRef.current = observed.revision;
          setRevision(observed.revision); saveState.succeed(submitted); setMessage("The saved revision was confirmed after the connection interrupted."); return;
        }
      } catch { /* Preserve the draft and show the original failure. */ }
      saveState.fail(); setMessage(error instanceof Error ? error.message : "Save could not be confirmed. Your draft is preserved.");
    } finally { operationRef.current = null; }
  }
  async function reload() {
    if (operationRef.current || saveState.pending || (saveState.dirty && !window.confirm("Replace your unsaved research draft with the saved revision? Copy any changes you need to keep first."))) return;
    operationRef.current = "reload";
    setReloading(true);
    const requestedDraft = JSON.stringify(currentDraftRef.current);
    const requestedRevision = revisionRef.current;
    const requestedDuplicateIdsText = duplicateIdsTextRef.current;
    try {
      const saved = await transport.load();
      if (JSON.stringify(currentDraftRef.current) !== requestedDraft || revisionRef.current !== requestedRevision || duplicateIdsTextRef.current !== requestedDuplicateIdsText) {
        setMessage("Research changed while the saved revision was loading. Your newer draft is preserved. Reload again when you are ready to replace it.");
        return;
      }
      setResearch(saved.research);
      duplicateIdsTextRef.current = saved.research.duplicateReview.candidateIds.join(", ");
      setDuplicateIdsText(duplicateIdsTextRef.current);
      revisionRef.current = saved.revision;
      setRevision(saved.revision); saveState.load(saved.research); setMessage("Saved research reloaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Saved research could not be loaded."); }
    finally { operationRef.current = null; setReloading(false); }
  }
  let preview;
  try { preview = buildRecipientPacketPreview(address, audience, validatePropertyResearch(research)); } catch { preview = null; }
  const scenarios = compareResearchScenarios(research);
  return <section className="property-research brand-card min-w-0 space-y-6 p-4 sm:p-6" aria-labelledby="property-research-heading" aria-busy={reloading || saveState.pending}>
    <header><h3 id="property-research-heading" className="text-2xl font-semibold">Research and scenarios</h3><p className="mt-2 text-base leading-7">Source-backed notes support review. Uploads and recorded amounts never establish clear title or a current payoff balance.</p><p className="mt-2 text-sm">Saved revision {revision}. Research stays internal unless you explicitly include a comparable in the recipient preview.</p></header>
    <WorkspaceSaveState state={saveState} label="Property research" />
    <div className="flex flex-wrap gap-3"><button type="button" className={button + " workspace-primary"} disabled={saveState.pending || reloading} onClick={save}>{saveState.pending ? "Saving research…" : "Save research"}</button><button type="button" className={button} disabled={saveState.pending || reloading} onClick={reload}>{reloading ? "Reloading saved research…" : "Reload saved revision"}</button></div>
    {message ? <p role="status" className="rounded-lg border border-[var(--line)] p-4 text-base leading-7">{message}</p> : null}
    <section aria-labelledby="comparable-heading" className="space-y-4"><h4 id="comparable-heading" className="text-xl font-semibold">Comparable sales and listings</h4><p>Listed prices are asking prices. Use sold records with a date and source to support a sale comparison.</p>
      {research.comps.map((item, index) => <fieldset key={item.id} className="min-w-0 space-y-4 rounded-xl border border-[var(--line)] p-4"><legend className="px-2 font-semibold">Comparable {index + 1}</legend><div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="space-y-2">Address<input className={field} value={item.address} onChange={event => updateComp(item.id, { address: event.target.value })} /></label>
        <label className="space-y-2">Record type<select className={field} value={item.status} onChange={event => updateComp(item.id, { status: event.target.value as ComparableEvidence["status"] })}><option value="unknown">Unknown</option><option value="listed">Listed — asking price</option><option value="sold">Sold — recorded sale</option></select></label>
        <label className="space-y-2">{item.status === "sold" ? "Sale price" : "Asking / observed price"} — blank is unknown<input type="number" min="0" step="0.01" className={field} value={item.price ?? ""} onChange={event => updateComp(item.id, { price: amount(event.target.value) })} /></label>
        <label className="space-y-2">{item.status === "sold" ? "Sale date" : "Listing / observation date"}<input type="date" className={field} value={item.date} onChange={event => updateComp(item.id, { date: event.target.value })} /></label>
        <label className="space-y-2">Square feet — blank is unknown<input type="number" min="0" className={field} value={item.squareFeet ?? ""} onChange={event => updateComp(item.id, { squareFeet: amount(event.target.value) })} /></label>
        <label className="space-y-2">Source link<input type="url" className={field} value={item.source.url} onChange={event => updateComp(item.id, { source: { ...item.source, url: event.target.value } })} /></label>
        <label className="space-y-2">Source document ID<input className={field} value={item.source.documentId} onChange={event => updateComp(item.id, { source: { ...item.source, documentId: event.target.value } })} /></label>
        <label className="space-y-2">Source accessed on<input type="date" className={field} value={item.source.accessedOn} onChange={event => updateComp(item.id, { source: { ...item.source, accessedOn: event.target.value } })} /></label>
      </div><label className="block space-y-2">Internal comparison notes<textarea className={field} value={item.notes} onChange={event => updateComp(item.id, { notes: event.target.value })} /></label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={item.share} onChange={event => updateComp(item.id, { share: event.target.checked })} />Include these structured facts in eligible packet previews</label>{item.source.url.startsWith("https://") ? <a className="inline-flex min-h-11 items-center break-all underline" href={item.source.url} target="_blank" rel="noreferrer">Open source</a> : null}<button type="button" className={button} onClick={() => setResearch(current => ({ ...current, comps: current.comps.filter(row => row.id !== item.id) }))}>Remove comparable {index + 1}</button></fieldset>)}
      <button type="button" className={button} disabled={research.comps.length >= 30} onClick={() => setResearch(current => ({ ...current, comps: [...current.comps, { id: crypto.randomUUID(), address: "", status: "unknown", price: null, date: "", squareFeet: null, source: { ...sourceEmpty }, notes: "", share: false }] }))}>Add comparable</button>
    </section>
    <section aria-labelledby="title-evidence-heading" className="space-y-4"><h4 id="title-evidence-heading" className="text-xl font-semibold">Loan, lien and title evidence</h4><p>Title status: unresolved by this workspace. A recorded mortgage amount is historical; a payoff statement has its own as-of date. Blank means unknown, and a documented zero needs a source.</p>
      {research.titleEvidence.map((item, index) => <fieldset key={item.id} className="min-w-0 space-y-4 rounded-xl border border-[var(--line)] p-4"><legend className="px-2 font-semibold">Evidence {index + 1}</legend><div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="space-y-2">Evidence type<select className={field} value={item.kind} onChange={event => updateTitle(item.id, { kind: event.target.value as TitleEvidence["kind"] })}><option value="recorded_mortgage">Recorded mortgage — original amount</option><option value="payoff_statement">Payoff statement — as-of balance</option><option value="lien">Lien record</option><option value="title_report">Title report</option></select></label>
        <label className="space-y-2">Amount evidence<select className={field} value={item.amountState} onChange={event => updateTitle(item.id, { amountState: event.target.value as TitleEvidence["amountState"], amount: event.target.value === "unknown" ? null : item.amount })}><option value="unknown">Unknown</option><option value="documented">Documented amount, including zero</option></select></label>
        <label className="space-y-2">Amount<input disabled={item.amountState === "unknown"} type="number" min="0" step="0.01" className={field} value={item.amount ?? ""} onChange={event => updateTitle(item.id, { amount: amount(event.target.value) })} /></label>
        <label className="space-y-2">Amount as-of date<input type="date" className={field} value={item.asOf} onChange={event => updateTitle(item.id, { asOf: event.target.value })} /></label>
        <label className="space-y-2">Source link<input type="url" className={field} value={item.source.url} onChange={event => updateTitle(item.id, { source: { ...item.source, url: event.target.value } })} /></label>
        <label className="space-y-2">Source document ID<input className={field} value={item.source.documentId} onChange={event => updateTitle(item.id, { source: { ...item.source, documentId: event.target.value } })} /></label>
        <label className="space-y-2">Source accessed on<input type="date" className={field} value={item.source.accessedOn} onChange={event => updateTitle(item.id, { source: { ...item.source, accessedOn: event.target.value } })} /></label>
        <label className="space-y-2">Review status<select className={field} value={item.status} onChange={event => updateTitle(item.id, { status: event.target.value as TitleEvidence["status"] })}><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed evidence — title still unresolved</option></select></label>
        <label className="space-y-2">Reviewer<input className={field} value={item.reviewer} onChange={event => updateTitle(item.id, { reviewer: event.target.value })} /></label>
      </div><label className="block space-y-2">Internal evidence notes<textarea className={field} value={item.notes} onChange={event => updateTitle(item.id, { notes: event.target.value })} /></label>{item.source.url.startsWith("https://") ? <a className="inline-flex min-h-11 items-center break-all underline" href={item.source.url} target="_blank" rel="noreferrer">Open evidence source</a> : null}<button type="button" className={button} onClick={() => setResearch(current => ({ ...current, titleEvidence: current.titleEvidence.filter(row => row.id !== item.id) }))}>Remove evidence {index + 1}</button></fieldset>)}
      <button type="button" className={button} disabled={research.titleEvidence.length >= 30} onClick={() => setResearch(current => ({ ...current, titleEvidence: [...current.titleEvidence, { id: crypto.randomUUID(), kind: "recorded_mortgage", amount: null, amountState: "unknown", asOf: "", source: { ...sourceEmpty }, reviewer: "", status: "unreviewed", notes: "" }] }))}>Add title evidence</button>
    </section>
    <section aria-labelledby="scenario-heading" className="space-y-4"><h4 id="scenario-heading" className="text-xl font-semibold">Low, base and high scenarios</h4><p>Each scenario uses the existing investment calculation. Change the assumptions explicitly; this does not replace the saved underwriting or an offer.</p><div className="grid min-w-0 gap-4 lg:grid-cols-3">{scenarios.map(({ label, analysis, error }) => {
      const scenario = research.scenarios.find(item => item.label === label);
      return <fieldset key={label} className="min-w-0 space-y-4 rounded-xl border border-[var(--line)] p-4"><legend className="px-2 font-semibold capitalize">{label}</legend>{scenario ? <><label className="block space-y-2">Strategy<select className={field} value={scenario.inputs.strategy} onChange={event => setResearch(current => ({ ...current, scenarios: current.scenarios.map(item => item.label === label ? { ...item, inputs: { ...item.inputs, strategy: event.target.value as InvestmentInputs["strategy"] } } : item) }))}><option value="assignment">Assignment</option><option value="flip">Flip</option><option value="rental">Rental</option></select></label>{inputFields.map(([key, name]) => <label key={key} className="block space-y-2">{name}<input type="number" min="0" step="0.01" className={field} value={scenario.inputs[key] ?? ""} onChange={event => { const value = amount(event.target.value); setResearch(current => ({ ...current, scenarios: current.scenarios.map(item => item.label === label ? { ...item, inputs: { ...item.inputs, [key]: value } } : item) })); }} /></label>)}<div className="space-y-2 text-base"><p>Calculation: {error ?? (analysis?.complete ? "Complete" : "Not evaluated — missing inputs")}</p><p>Purchase ceiling: {researchMoney(analysis?.ceiling ?? null)}</p><p>Profit before income tax: {researchMoney(analysis?.profit ?? null)}</p><p>Monthly cash flow: {researchMoney(analysis?.monthlyCashFlow ?? null)}</p></div></> : <p>No scenario entered.</p>}<button type="button" className={button} onClick={() => setResearch(current => ({ ...current, scenarios: [...current.scenarios.filter(item => item.label !== label), { label, inputs: baseline(underwriting) }] }))}>{scenario ? "Reset from saved underwriting" : "Start from saved underwriting"}</button></fieldset>;
    })}</div></section>
    <section aria-labelledby="duplicate-heading" className="space-y-4"><h4 id="duplicate-heading" className="text-xl font-semibold">Duplicate review</h4><p>Record possible duplicate property IDs for human review. This does not delete or merge any property.</p><label className="block space-y-2">Possible duplicate IDs, separated by commas<input className={field} value={duplicateIdsText} onChange={event => updateDuplicateCandidateIds(event.target.value)} /></label><label className="block space-y-2">Decision<select className={field} value={research.duplicateReview.decision} onChange={event => setResearch(current => ({ ...current, duplicateReview: { ...current.duplicateReview, decision: event.target.value as PropertyResearch["duplicateReview"]["decision"] } }))}><option value="not_reviewed">Not reviewed</option><option value="possible_duplicate">Possible duplicate — keep both records</option><option value="distinct">Reviewed as distinct properties</option></select></label><label className="block space-y-2">Internal review notes<textarea className={field} value={research.duplicateReview.notes} onChange={event => setResearch(current => ({ ...current, duplicateReview: { ...current.duplicateReview, notes: event.target.value } }))} /></label></section>
    <label className="block space-y-2">Private internal notes — excluded from every recipient preview<textarea className={field} value={research.privateNotes} onChange={event => setResearch(current => ({ ...current, privateNotes: event.target.value }))} /></label>
    <section aria-labelledby="recipient-preview-heading" className="space-y-4"><h4 id="recipient-preview-heading" className="text-xl font-semibold">Recipient packet preview</h4><label className="block space-y-2">Recipient type<select className={field} value={audience} onChange={event => setAudience(event.target.value as PacketAudience)}><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="jv">JV partner</option><option value="title">Title / closing professional</option></select></label><p>Only explicitly included comparable facts enter buyer and JV previews. Reviewed title facts appear only for the title recipient. Internal notes, seller contact details, negotiating ceilings and scenario profit targets are excluded.</p>{preview ? <div className="space-y-4 rounded-xl border border-[var(--line)] p-4"><h5 className="font-semibold">{preview.propertyAddress}</h5><p>Recipient: {preview.audience}</p><p>{preview.titleStatus}</p>{preview.comparableResearch.map((item, index) => <article key={index} className="space-y-2 border-t border-[var(--line)] pt-3"><h6 className="font-semibold">{item.address}</h6><p>{item.status === "sold" ? "Sold" : item.status === "listed" ? "Listed — asking price" : "Status unknown"} · {researchMoney(item.price)} · {item.date || "Date unknown"}</p><a className="inline-flex min-h-11 items-center break-all underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Source, accessed {item.sourceAccessedOn}</a></article>)}{preview.titleEvidence.map((item, index) => <article key={index} className="border-t border-[var(--line)] pt-3"><p>{item.kind.replaceAll("_", " ")} · {researchMoney(item.amount)} · as of {item.asOf || "unknown"}</p>{item.sourceUrl ? <a className="inline-flex min-h-11 items-center break-all underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Evidence source</a> : <p>Document {item.sourceDocumentId}</p>}</article>)}{!preview.comparableResearch.length && !preview.titleEvidence.length ? <p>No research facts included for this recipient.</p> : null}<p className="text-sm">{preview.notice}</p></div> : <p role="status">Review research fields before previewing a packet. No private notes are included.</p>}</section>
  </section>;
}
