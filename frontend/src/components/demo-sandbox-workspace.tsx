"use client";

import "./deal-workspace.css";

import { useEffect, useId, useState, type FormEvent } from "react";
import { analyzeDemoDeal, demoStages, type DemoLead, type DemoState } from "@/lib/demo-sandbox";
import type { DemoSnapshot } from "@/lib/demo-access-server";

const money = (n: number | null | undefined) => n == null ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const input = "mt-2 w-full rounded-xl border border-white/30 bg-zinc-950 p-3 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200";
const button = "min-h-11 rounded-xl bg-amber-300 px-4 py-3 font-semibold text-black disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const secondary = "min-h-11 rounded-xl border border-white/30 px-4 py-3 text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200";
const card = "rounded-2xl border border-white/20 bg-zinc-900/60 p-5";
type Draft = Record<string, string>;

function AmountField({ name, label, help, value }: { name: string; label: string; help: string; value?: number | string | null }) {
  const helpId = useId();
  return <label className="block text-base text-zinc-200">{label}<input key={name} name={name} type="number" min="0" max="100000000" step="0.01" inputMode="decimal" defaultValue={value ?? ""} className={input} aria-describedby={helpId} /><span id={helpId} className="mt-2 block text-sm leading-6 text-zinc-300">{help} Leave blank if unknown; enter 0 only when none applies.</span></label>;
}
function Analysis({ lead }: { lead: DemoLead }) {
  const a = analyzeDemoDeal(lead);
  return <div className={card + " space-y-3"}>
    <h3 className="text-lg font-semibold">What the numbers say</h3>
    <p className="text-zinc-200">{!a.complete ? "Missing figures — this calculation is incomplete." : a.strategy === "rental" ? (a.fitsTarget ? "Positive monthly cash flow using your entered figures. Research and purchase terms still need review." : "Monthly cash flow is zero or negative. Review the rent, expenses and financing.") : a.fitsTarget ? "Meets the entered profit target. Research and purchase terms still need review." : "Does not meet the entered profit target. Review the price and assumptions."}</p>
    {a.missing.length > 0 && <p className="text-sm leading-6 text-amber-200">Still needed: {a.missing.join(", ")}.</p>}
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="text-sm text-zinc-300">Purchase, repair and entered closing costs</dt><dd className="mt-1 text-xl">{money(a.acquisitionCost)}</dd></div>
      {a.strategy === "rental" ? <>
        <div><dt className="text-sm text-zinc-300">Monthly cash flow after entered expenses and loan payment</dt><dd className="mt-1 text-xl">{money(a.monthlyCashFlow)}</dd></div>
        <div><dt className="text-sm text-zinc-300">Annual cash flow / acquisition cost</dt><dd className="mt-1 text-xl">{a.annualReturnOnCost == null ? "Unknown" : a.annualReturnOnCost.toFixed(1) + "%"}</dd></div>
      </> : <>
        <div><dt className="text-sm text-zinc-300">Purchase ceiling at your profit target</dt><dd className="mt-1 text-xl">{money(a.ceiling)}</dd></div>
        <div><dt className="text-sm text-zinc-300">Ceiling minus asking/proposed purchase price</dt><dd className="mt-1 text-xl">{money(a.askingGap)}</dd></div>
        <div><dt className="text-sm text-zinc-300">{a.strategy === "assignment" ? "End buyer's projected profit after your fee" : "Projected resale profit"}</dt><dd className="mt-1 text-xl">{money(a.profit)}</dd></div>
      </>}
    </dl>
    <p className="text-sm leading-6 text-zinc-300">Results use entered assumptions, not a verified valuation. Losses stay visible. Rental return here is not leveraged cash-on-cash return. {a.legacy ? "This older practice record retains its original 30% resale reserve until you select a strategy and save explicit costs." : ""}</p>
  </div>;
}

export function DemoSandboxWorkspace({ snapshot, expires }: { snapshot: DemoSnapshot; expires: string }) {
  const [data, setData] = useState<{ state: DemoState; revision: number } | null>(null);
  const [tab, setTab] = useState("Properties");
  const [section, setSection] = useState("Overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [capture, setCapture] = useState<Draft>({});
  const [captureVersion, setCaptureVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/demo/workspace", { cache: "no-store" }); const b = await r.json();
    if (!r.ok) throw Error(b.error); setData(b);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/demo/workspace", { cache: "no-store" }).then(async r => {
      const b = await r.json(); if (!r.ok) throw Error(b.error); if (active) setData(b);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function act(body: Record<string, unknown>) {
    if (!data || busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/demo/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, revision: data.revision }) });
      const b = await r.json();
      if (!r.ok) { if (r.status === 409) await load(); throw Error(r.status === 409 ? "Someone saved a newer version. Your draft is retained; review the latest record before saving again." : b.error); }
      setData(b); setNotice("Saved in your practice workspace."); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); return false; }
    finally { setBusy(false); }
  }
  function openProperty(id: string) { setSelected(id); setSection("Overview"); setTab("Properties"); }
  function remember(e: FormEvent<HTMLFormElement>, id: string) {
    const values = Object.fromEntries(new FormData(e.currentTarget)) as Draft;
    setDrafts(current => ({ ...current, [id]: { ...current[id], ...values } }));
  }
  function exportRecords() {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ label: "Blackspire isolated demonstration records", ...data.state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "blackspire-demo-records.json"; a.click(); URL.revokeObjectURL(url);
  }
  const lead = data?.state.leads.find(l => l.id === selected);
  const draft = lead ? drafts[lead.id] ?? {} : {};
  const value = (key: keyof DemoLead) => draft[key] ?? lead?.[key] as string | number | null | undefined;
  return <main className="deal-workspace min-h-screen bg-[#050505] px-4 py-8 text-white"><div className="mx-auto max-w-6xl space-y-6">
    <header className={card}>
      <p className="text-sm text-amber-200">Blackspire · Private practice workspace</p>
      <h1 className="mt-3 text-3xl font-bold">Review a property. Know your next step.</h1>
      <p className="mt-3 max-w-3xl leading-7 text-zinc-200">Start with what you know. Research and numbers stay together. Practice records are fictional or entered by you; the live reference is separate.</p>
      <p className="mt-3 text-sm text-zinc-300">Access expires {expires}. No outreach is sent and no paid services are called.</p>
      <a className="mt-3 inline-block min-h-11 py-3 underline text-zinc-200" href="/demo/login">Sign in on another device</a>
    </header>
    <nav aria-label="Workspace tools" className="flex flex-wrap gap-2">{["Properties", "Follow-ups", "Activity", "Buyer reference", "Live snapshot"].map(t => <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={tab === t ? button : secondary}>{t}</button>)}</nav>
    {error && <p role="alert" className="rounded-xl border border-red-400 p-4 text-red-200">{error}</p>}
    {notice && <p role="status" className="workspace-feedback text-sm">{notice}</p>}
    {!data ? <p>Opening your workspace…</p> : <>
      {tab === "Properties" && !lead && <section className="space-y-5">
        <h2 className="text-2xl font-semibold">Add or review a property</h2>
        <form className={card + " grid gap-4 sm:grid-cols-2"} onChange={e => setCapture(Object.fromEntries(new FormData(e.currentTarget)) as Draft)} onSubmit={async e => {
          e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));
          if (await act({ action: "addLead", ...values })) { setCapture({}); setCaptureVersion(current => current + 1); }
        }} key={captureVersion}><fieldset disabled={busy} className="contents">
          <label>Address or property label<input name="name" defaultValue={capture.name} required maxLength={200} className={input} /><span className="mt-2 block text-sm text-zinc-300">Use the listing address or a label you recognize.</span></label>
          <label>City<input name="city" defaultValue={capture.city} required maxLength={200} className={input} /></label>
          <label>How would you purchase it?<select name="strategy" defaultValue={capture.strategy ?? "flip"} className={input}><option value="flip">Buy and flip</option><option value="rental">Buy and rent</option><option value="assignment">Assign my purchase contract</option></select></label>
          <AmountField name="asking" label="Seller's asking price ($)" help="The price in the listing or conversation." value={capture.asking} />
          <div className="sm:col-span-2"><p className="mb-3 text-sm text-zinc-300">You can save now without a resale value or repair estimate.</p><button disabled={busy} className={button}>{busy ? "Saving…" : "Save property"}</button></div>
        </fieldset></form>
        {data.state.leads.map(l => <article key={l.id} className={card}><h3 className="text-xl font-semibold">{l.name}</h3><p className="mt-2 text-zinc-300">{l.city} · {l.stage} · Asking {money(l.asking)}</p><button className={button + " mt-4"} onClick={() => openProperty(l.id)}>Review property</button></article>)}
      </section>}
      {tab === "Properties" && lead && <section className="space-y-5">
        <button className={secondary} onClick={() => setSelected(null)}>Back to properties</button>
        <header><h2 className="text-2xl font-bold">{lead.name}</h2><p className="mt-2 text-zinc-300">{lead.city} · Practice stage: {lead.stage}</p>{Object.keys(draft).length > 0 && <p className="mt-2 text-amber-200">Unsaved edits are retained while you switch sections. Save before leaving this page.</p>}</header>
        <nav aria-label="Property sections" className="flex flex-wrap gap-2">{["Overview", "Research & comps", "Numbers", "Notes & next steps", "Contract & closing"].map(s => <button key={s} onClick={() => setSection(s)} aria-pressed={section === s} className={section === s ? button : secondary}>{s}</button>)}</nav>
        {section === "Overview" && <><Analysis lead={lead} /><div className={card}><h3 className="text-lg font-semibold">Next step</h3><p className="mt-3 leading-7 text-zinc-200">{analyzeDemoDeal(lead).complete ? "Review the research and seller terms before deciding to proceed." : "Collect missing figures in Numbers. You can research the property at any time."}</p><button className={button + " mt-4"} onClick={() => setSection("Numbers")}>Review numbers</button></div></>}
        {["Numbers", "Research & comps", "Notes & next steps", "Contract & closing"].includes(section) && <form key={lead.id + section} className={card + " space-y-5"} onChange={e => remember(e, lead.id)} onSubmit={async e => {
          e.preventDefault(); const values = { ...draft, ...Object.fromEntries(new FormData(e.currentTarget)) };
          if (await act({ action: "updateLead", id: lead.id, ...values })) setDrafts(current => { const next = { ...current }; delete next[lead.id]; return next; });
        }}><fieldset disabled={busy} className="contents">
          {section === "Numbers" && <>
            <label className="block">Purchase strategy<select className={input} name="strategy" defaultValue={String(value("strategy") ?? "assignment")}><option value="flip">Buy and flip</option><option value="rental">Buy and rent</option><option value="assignment">Assign my purchase contract</option></select></label>
            <div className="grid gap-5 sm:grid-cols-2">
              <AmountField name="asking" label="Asking / proposed purchase price ($)" help="The acquisition price you are testing; changing it does not send an offer." value={value("asking")} />
              <AmountField name="repairs" label="Repair budget ($)" help="Total expected repair spend." value={value("repairs")} />
              <AmountField name="closingCosts" label="Acquisition / sale closing costs ($)" help="Include applicable fees; for rental, use acquisition costs only." value={value("closingCosts")} />
              {String(value("strategy") ?? "assignment") === "rental" ? <>
                <AmountField name="monthlyRent" label="Monthly rent ($)" help="Expected total monthly rental income." value={value("monthlyRent")} />
                <AmountField name="monthlyExpenses" label="Monthly operating expenses ($)" help="Include taxes, insurance, maintenance, vacancy reserve and management." value={value("monthlyExpenses")} />
                <AmountField name="monthlyDebtService" label="Monthly loan payment ($)" help="Expected monthly debt payment." value={value("monthlyDebtService")} />
              </> : <>
                <AmountField name="arv" label="Expected resale value after repairs ($)" help="Expected sale price after completing repairs; support it with sold comps." value={value("arv")} />
                <AmountField name="holdingCosts" label="Holding and financing costs ($)" help="Total costs during ownership, including applicable interest and utilities." value={value("holdingCosts")} />
                <AmountField name="profitTarget" label="Required profit ($)" help="Your profit target, or the end buyer's target for an assignment." value={value("profitTarget")} />
                {String(value("strategy") ?? "assignment") === "assignment" && <AmountField name="assignmentFee" label="Your assignment fee target ($)" help="Your proposed fee, separate from the end buyer's profit." value={value("assignmentFee")} />}
              </>}
            </div><p className="text-sm text-zinc-300">Save to recalculate. Numbers are your assumptions until supported by research.</p>
          </>}
          {section === "Research & comps" && <>
            <h3 className="text-xl font-semibold">Research notes and sources</h3><p className="leading-7 text-zinc-200">Automatic sold comps, loan and lien research are not connected in this practice workspace. Record your sources here. No retrieved lien information does not mean clear title, and an estimated loan balance is not a payoff quote.</p>
            <label className="block">Property facts, sold comps, loan/lien findings<textarea name="researchNotes" className={input + " min-h-40"} maxLength={3000} defaultValue={String(value("researchNotes") ?? "")} /></label>
            <label className="block">Source or document reference<input name="researchSource" className={input} maxLength={500} defaultValue={String(value("researchSource") ?? "")} /></label>
            <label className="block">Date checked<input name="researchAsOf" className={input} type="date" defaultValue={String(value("researchAsOf") ?? "")} /></label>
          </>}
          {section === "Notes & next steps" && <label className="block">Shared property notes<textarea name="note" className={input + " min-h-40"} maxLength={2000} defaultValue={String(value("note") ?? "")} /></label>}
          {section === "Contract & closing" && <>
            <p className="leading-7 text-zinc-200">This is a practice status only. It does not create, sign or confirm a real agreement. In the full workflow, deposits, title, signatures and closing documents remain separate records.</p>
            <label className="block">Practice stage<select className={input} name="stage" defaultValue={String(value("stage"))}>{demoStages.map(s => <option key={s}>{s}</option>)}</select></label>
          </>}
          <button disabled={busy} className={button}>{busy ? "Saving…" : "Save property changes"}</button>
        </fieldset></form>}
        {section === "Numbers" && <Analysis lead={lead} />}
        {section === "Notes & next steps" && <><button disabled={busy || Object.keys(draft).length > 0} className={secondary} onClick={() => act({ action: "runPipeline", id: lead.id })}>Create next step from saved numbers</button>{data.state.tasks.filter(t => t.leadId === lead.id).map(t => <p className={card} key={t.id}>{t.done ? "Completed: " : "Next step: "}{t.text}</p>)}</>}
      </section>}
      {tab === "Follow-ups" && <section className="space-y-5"><h2 className="text-2xl font-semibold">Who needs to do what next?</h2><form className={card + " grid gap-4 sm:grid-cols-2"} onSubmit={e => { e.preventDefault(); void act({ action: "addTask", ...Object.fromEntries(new FormData(e.currentTarget)) }); }}>
        <label className="sm:col-span-2">Next action<input name="text" required maxLength={500} className={input} /></label><label>Person responsible<input name="owner" maxLength={200} className={input} /></label><label>Due date<input name="dueDate" type="date" className={input} /></label><label>Property<select name="leadId" className={input}><option value="">General task</option>{data.state.leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button disabled={busy} className={button}>Add follow-up</button>
      </form>{data.state.tasks.map(t => <label key={t.id} className={card + " flex items-start gap-4"}><input type="checkbox" className="mt-1 h-6 w-6" checked={t.done} disabled={busy} onChange={() => act({ action: "toggleTask", id: t.id })} /><span className={t.done ? "line-through text-zinc-300" : ""}>{t.text}<span className="mt-2 block text-sm text-zinc-300">{t.owner || "Unassigned"}{t.dueDate ? " · Due " + t.dueDate : ""}</span></span></label>)}</section>}
      {tab === "Activity" && <section className="space-y-3"><h2 className="text-2xl font-semibold">Saved activity</h2>{data.state.activity.map((a, i) => <p key={i} className={card}>{a}</p>)}</section>}
      {tab === "Buyer reference" && <section className="space-y-5"><h2 className="text-2xl font-semibold">Historical buyer activity</h2><p className="leading-7 text-zinc-200">Read-only snapshot captured {new Date(snapshot.capturedAt).toLocaleString()}. Activity is not a confirmed fit, available funding or commitment to purchase your property. Contact details are excluded.</p>{snapshot.buyers.length ? snapshot.buyers.map((b, i) => <article key={i} className={card}><h3 className="text-lg font-semibold">{b.name}</h3><p className="mt-3 text-zinc-300">{b.purchases} recorded purchases · Activity score {b.score} · {b.cash ? "Historical cash signal" : "No historical cash signal"}</p></article>) : <p>No buyer reference data available.</p>}</section>}
      {tab === "Live snapshot" && <section><h2 className="text-2xl font-semibold">Live system · read-only reference</h2><p className="mt-3 text-zinc-200">Your practice edits do not change these live records.</p><div className="mt-5 grid gap-4 sm:grid-cols-3">{Object.entries(snapshot.metrics).map(([k, v]) => <div key={k} className={card}><p className="text-3xl text-amber-200">{v}</p><p className="mt-3">{k.replace(/([A-Z])/g, " $1")}</p></div>)}</div></section>}
      <footer className="flex flex-wrap gap-3 border-t border-white/20 pt-6"><button className={secondary} onClick={exportRecords}>Download saved practice records</button><button disabled={busy} className={secondary} onClick={async () => { if (confirm("Reset only your practice records? Unsaved drafts will be cleared.")) { if (await act({ action: "reset" })) { setSelected(null); setDrafts({}); setCapture({}); setCaptureVersion(current => current + 1); } } }}>Reset practice workspace</button></footer>
    </>}
  </div></main>;
}
