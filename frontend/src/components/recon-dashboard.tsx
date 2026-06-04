"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { matchOpportunity } from "@/lib/matching/matchOpportunity";
import { reconIndustries } from "@/lib/recon-engine";
import type { RecentOpportunity } from "@/lib/recon-engine-server";

type ScoredOpportunity = RecentOpportunity & {
  score: number;
  reasons: string[];
  daysLeft: number | null;
};

function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
}

function fitTone(score: number): string {
  if (score >= 70) return "#34d399"; // green
  if (score >= 45) return "#c4b5fd"; // purple
  return "#9ca3af"; // gray
}

const PROFILE_KEY = "recon.profile.v1";
const SAVED_KEY = "recon.saved.v1";

type ProposalDraftView = {
  coverLetter: string;
  capabilityStatement: string;
  responseChecklist: string;
  procurementQuestions: string;
  proposalOutline: string;
};
type ProposalState = { loading: boolean; draft?: ProposalDraftView; error?: string };

export function ReconDashboard({
  opportunities,
  initialProfile,
  isAuthed,
}: {
  opportunities: RecentOpportunity[];
  initialProfile?: { industry?: string; services?: string; county?: string; state?: string };
  isAuthed?: boolean;
}) {
  const [proposals, setProposals] = useState<Record<string, ProposalState>>({});

  async function generateProposal(bidId: string) {
    setProposals((prev) => ({ ...prev, [bidId]: { loading: true } }));
    try {
      const res = await fetch("/api/recon/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId }),
      });
      const data = (await res.json()) as { ok: boolean; draft?: ProposalDraftView; error?: string };
      if (!res.ok || !data.ok || !data.draft) throw new Error(data.error || "Generation failed.");
      setProposals((prev) => ({ ...prev, [bidId]: { loading: false, draft: data.draft } }));
    } catch (err) {
      setProposals((prev) => ({ ...prev, [bidId]: { loading: false, error: err instanceof Error ? err.message : "Generation failed." } }));
    }
  }
  const [industry, setIndustry] = useState(initialProfile?.industry ?? "");
  const [services, setServices] = useState(initialProfile?.services ?? "");
  const [county, setCounty] = useState(initialProfile?.county ?? "");
  const [state, setState] = useState(initialProfile?.state ?? "NC");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Load persisted profile + saved opportunities (browser-local, no account needed).
  useEffect(() => {
    try {
      // A logged-in account profile takes precedence; otherwise restore from localStorage.
      if (!initialProfile) {
        const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
        if (p) {
          if (typeof p.industry === "string") setIndustry(p.industry);
          if (typeof p.services === "string") setServices(p.services);
          if (typeof p.county === "string") setCounty(p.county);
          if (typeof p.state === "string") setState(p.state);
        }
      }
      const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
      if (Array.isArray(s)) setSavedIds(s.filter((x) => typeof x === "string"));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [initialProfile]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ industry, services, county, state }));
  }, [hydrated, industry, services, county, state]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds));
  }, [hydrated, savedIds]);

  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);
  function toggleSave(id: string) {
    setSavedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const scored = useMemo<ScoredOpportunity[]>(() => {
    const profile = {
      industry,
      serviceKeywords: services.split(",").map((s) => s.trim()).filter(Boolean),
      countiesServed: county ? [county] : [],
      state,
    };
    return opportunities
      .map((opp) => {
        const match = matchOpportunity(
          {
            title: opp.title,
            category: opp.category,
            location: opp.location,
            opportunityType: opp.category,
            bestFitIndustries: opp.bestFitIndustries,
            keywords: opp.keywords,
          },
          profile,
        );
        return { ...opp, score: match.score, reasons: match.reasons, daysLeft: daysUntil(opp.deadline) };
      })
      .sort((a, b) => b.score - a.score);
  }, [opportunities, industry, services, county, state]);

  const stats = useMemo(() => {
    const total = scored.length;
    const deadlineSoon = scored.filter((o) => o.daysLeft !== null && o.daysLeft >= 0 && o.daysLeft <= 14).length;
    const highFit = scored.filter((o) => o.score >= 60).length;
    const avg = total ? Math.round(scored.reduce((s, o) => s + o.score, 0) / total) : 0;
    return { total, deadlineSoon, highFit, avg };
  }, [scored]);

  const recommendations = scored.slice(0, 3);
  const deadlines = [...scored]
    .filter((o) => o.daysLeft !== null && o.daysLeft >= 0)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .slice(0, 6);

  const profileActive = Boolean(industry || services || county);

  return (
    <div className="space-y-8">
      {/* Profile controls */}
      <section className="brand-panel px-6 py-6">
        <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>
          Your business profile
        </p>
        <p className="mt-2 text-sm text-[var(--copy-soft)]">
          Set your profile to fit-score every live opportunity in real time.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="grid gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Industry</span>
            <select className="contact-input brand-input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">Any</option>
              {reconIndustries.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Services (comma-sep)</span>
            <input className="contact-input" value={services} onChange={(e) => setServices(e.target.value)} placeholder="mowing, cleanup" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">County</span>
            <input className="contact-input" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="Forsyth" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">State</span>
            <input className="contact-input" value={state} onChange={(e) => setState(e.target.value)} placeholder="NC" />
          </label>
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live opportunities" value={String(stats.total)} detail="In the current feed" />
        <Stat label="Closing in 14 days" value={String(stats.deadlineSoon)} detail="Act soon" />
        <Stat label="Strong fits" value={String(stats.highFit)} detail={profileActive ? "Score 60+ for your profile" : "Set a profile to score"} />
        <Stat label="Avg fit score" value={profileActive ? `${stats.avg}` : "--"} detail="Across the feed" />
      </section>

      {/* AI recommendations */}
      <section className="brand-panel px-6 py-6">
        <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>AI recommendations</p>
        <h2 className="brand-display mt-2 text-2xl text-white">Top opportunities for you right now</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {recommendations.length ? recommendations.map((opp) => (
            <div key={opp.id} className="brand-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Fit</span>
                <span className="text-lg font-black" style={{ color: fitTone(opp.score) }}>{opp.score}</span>
              </div>
              <h3 className="mt-1 text-sm font-semibold text-white line-clamp-2">{opp.title}</h3>
              <p className="mt-1 text-xs text-[var(--copy-muted)]">{opp.agency ?? "--"}</p>
              {opp.reasons[0] ? <p className="mt-2 text-xs leading-5 text-[var(--copy-soft)]">{opp.reasons[0]}</p> : null}
            </div>
          )) : <p className="text-sm text-[var(--copy-soft)]">No opportunities yet -- the daily feed will populate this.</p>}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        {/* Opportunity feed */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Opportunity feed</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowSavedOnly(false)}
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] transition ${!showSavedOnly ? "border-[hsl(258_90%_70%/.6)] text-white" : "border-[var(--line)] text-[var(--copy-muted)]"}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setShowSavedOnly(true)}
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] transition ${showSavedOnly ? "border-[hsl(258_90%_70%/.6)] text-white" : "border-[var(--line)] text-[var(--copy-muted)]"}`}
              >
                Saved ({savedIds.length})
              </button>
            </div>
          </div>
          {scored.filter((opp) => (showSavedOnly ? savedSet.has(opp.id) : true)).map((opp) => (
            <article key={opp.id} className="brand-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-white">{opp.title}</h3>
                  <p className="mt-1 text-xs text-[var(--copy-muted)]">{opp.agency ?? "--"}{opp.location ? ` | ${opp.location}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggleSave(opp.id)}
                    aria-label={savedSet.has(opp.id) ? "Unsave" : "Save"}
                    className="text-lg leading-none transition"
                    style={{ color: savedSet.has(opp.id) ? "#c4b5fd" : "var(--copy-muted)" }}
                  >
                    {savedSet.has(opp.id) ? "★" : "☆"}
                  </button>
                  <div className="text-right">
                    <div className="text-2xl font-black leading-none" style={{ color: fitTone(opp.score) }}>{opp.score}</div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-[var(--copy-muted)]">fit</div>
                  </div>
                </div>
              </div>
              {opp.summary ? <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{opp.summary}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {opp.bestFitIndustries.slice(0, 4).map((ind) => (
                  <span key={ind} className="recon-pill">{ind}</span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--copy-muted)]">
                <span>
                  {opp.daysLeft !== null
                    ? opp.daysLeft >= 0
                      ? `Closes in ${opp.daysLeft} day${opp.daysLeft === 1 ? "" : "s"}`
                      : "Closed"
                    : "No deadline listed"}
                </span>
                {opp.originalUrl ? (
                  <a href={opp.originalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold" style={{ color: "#c4b5fd" }}>
                    View on SAM.gov →
                  </a>
                ) : null}
              </div>

              {/* Proposal generator (Commander feature) */}
              <div className="mt-4 border-t border-[var(--line)] pt-3">
                {isAuthed ? (
                  <button
                    type="button"
                    onClick={() => generateProposal(opp.id)}
                    disabled={proposals[opp.id]?.loading}
                    className="recon-button inline-flex px-4 py-2 text-xs uppercase tracking-[0.16em] disabled:opacity-60"
                  >
                    {proposals[opp.id]?.loading
                      ? "Generating proposal..."
                      : proposals[opp.id]?.draft
                        ? "Regenerate proposal"
                        : "Generate proposal"}
                  </button>
                ) : (
                  <Link href="/recon-engine/login" className="text-xs font-semibold" style={{ color: "#c4b5fd" }}>
                    Sign in to generate an AI proposal →
                  </Link>
                )}
                {proposals[opp.id]?.error ? (
                  <p className="mt-2 text-xs text-amber-300">{proposals[opp.id]?.error}</p>
                ) : null}
                {proposals[opp.id]?.draft ? (
                  <div className="mt-3 space-y-3">
                    <ProposalSection title="Cover letter" body={proposals[opp.id]!.draft!.coverLetter} />
                    <ProposalSection title="Capability statement" body={proposals[opp.id]!.draft!.capabilityStatement} />
                    <ProposalSection title="Response checklist" body={proposals[opp.id]!.draft!.responseChecklist} />
                    <ProposalSection title="Procurement questions" body={proposals[opp.id]!.draft!.procurementQuestions} />
                    <ProposalSection title="Proposal outline" body={proposals[opp.id]!.draft!.proposalOutline} />
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {showSavedOnly && savedIds.length === 0 ? (
            <div className="brand-card p-5 text-sm text-[var(--copy-soft)]">
              No saved opportunities yet. Tap the ☆ on any opportunity to save it here.
            </div>
          ) : null}
          {!scored.length ? (
            <div className="brand-card p-5 text-sm text-[var(--copy-soft)]">
              No opportunities yet. The daily fetch will populate the feed.
            </div>
          ) : null}
        </section>

        {/* Sidebar: deadlines + plan */}
        <aside className="space-y-6">
          <section className="brand-panel px-5 py-5">
            <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Upcoming deadlines</p>
            <div className="mt-3 space-y-2">
              {deadlines.length ? deadlines.map((opp) => (
                <div key={opp.id} className="brand-card p-3">
                  <p className="text-xs font-semibold text-white line-clamp-2">{opp.title}</p>
                  <p className="mt-1 text-[11px]" style={{ color: opp.daysLeft !== null && opp.daysLeft <= 7 ? "#f59e0b" : "var(--copy-muted)" }}>
                    {opp.daysLeft} days left
                  </p>
                </div>
              )) : <p className="text-sm text-[var(--copy-soft)]">No upcoming deadlines.</p>}
            </div>
          </section>

          <section className="brand-panel px-5 py-5">
            <p className="text-[10px] uppercase tracking-[0.42em]" style={{ color: "#c4b5fd" }}>Your plan</p>
            <p className="mt-2 text-sm text-[var(--copy-soft)]">
              You&apos;re previewing the live feed. Subscribe to unlock fit-scored alerts, saved
              opportunities, and AI proposal drafts.
            </p>
            <Link href="/recon-engine#pricing" className="recon-button mt-4 inline-flex w-full justify-center px-5 py-3 text-sm uppercase tracking-[0.16em]">
              View plans
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="brand-card p-5">
      <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--copy-muted)]">{label}</div>
      <div className="brand-accent-text mt-2 text-3xl font-black">{value}</div>
      <div className="mt-1 text-xs text-[var(--copy-soft)]">{detail}</div>
    </div>
  );
}

function ProposalSection({ title, body }: { title: string; body: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="brand-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.24em]" style={{ color: "#c4b5fd" }}>{title}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-[10px] uppercase tracking-[0.16em] text-[var(--copy-muted)] transition hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-xs leading-6 text-[var(--copy-soft)]">{body}</pre>
    </div>
  );
}
