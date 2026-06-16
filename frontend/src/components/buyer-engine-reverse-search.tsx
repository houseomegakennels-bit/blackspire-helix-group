"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { BuyerShell, Metric, Panel, StatusPill } from "@/components/buyer-shell";
import type {
  BuyerReverseSearchCriteria,
  BuyerReverseSearchMatch,
  OperatorShellStatus,
} from "@/lib/buyer-engine-server";

type ReverseSearchResponse = {
  ok?: boolean;
  error?: string;
  matches?: BuyerReverseSearchMatch[];
  generatedAt?: string;
};

const initialCriteria: BuyerReverseSearchCriteria = {
  buyerName: "",
  buyerGroup: "",
  targetCounty: "",
  targetCity: "",
  targetZipCodes: [],
  propertyType: "",
  minBeds: null,
  maxPrice: null,
  minimumArvSpread: null,
  buyBoxNotes: "",
  buyerProfileType: "unknown",
  preferredRadius: null,
  activeOnly: true,
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function BuyerEngineReverseSearchPage({
  operatorStatus,
}: {
  operatorStatus: OperatorShellStatus | null;
}) {
  const [criteria, setCriteria] = useState(initialCriteria);
  const [matches, setMatches] = useState<BuyerReverseSearchMatch[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const metrics = useMemo(() => {
    const highScore = matches.filter((match) => match.matchScore >= 80).length;
    const dealCount = matches.filter((match) => match.sourceType === "deal").length;
    const sellerCount = matches.filter((match) => match.sourceType === "seller_lead").length;
    return {
      total: matches.length,
      highScore,
      dealCount,
      sellerCount,
    };
  }, [matches]);

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await fetch("/api/buyer-engine/reverse-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...criteria,
          targetZipCodes: criteria.targetZipCodes,
        }),
      });

      const payload = (await response.json()) as ReverseSearchResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Reverse search failed.");
      }

      setMatches(payload.matches ?? []);
      setGeneratedAt(payload.generatedAt ?? new Date().toISOString());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Reverse search failed.");
      setMatches([]);
      setGeneratedAt(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <BuyerShell
      eyebrow="Reverse Search"
      title="Buyer-to-seller opportunity command"
      description="Start from the buyer box, then pull the strongest seller-side and deal-side opportunities already inside the Blackspire real-estate stack."
      operatorStatus={operatorStatus}
    >
      <section className="brand-panel overflow-hidden px-6 py-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[40%] bg-[radial-gradient(circle_at_center,hsl(34_100%_60%/.1),transparent_72%)]" />
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">
              Reverse flow
            </p>
            <h3 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
              Start with buyer demand, then hunt backward into the pipeline.
            </h3>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              This surface flips the normal Seller to Buyer sequence and lets the operator search
              for opportunities that already fit a named buyer, a hedge-fund lane, or a clear buy
              box before the next packet is built.
            </p>
          </div>

          <div className="brand-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="good" label="seller -> nexus -> deal -> buyer intact" />
              <StatusPill tone="active" label="buyer -> seller reverse lane live" />
            </div>
            <div className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
              Use this when a buyer says, &quot;Send me more like this,&quot; and the team needs to surface
              matching inventory already flowing through Seller Engine and Deal Engine.
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Matches" value={String(metrics.total).padStart(2, "0")} detail="Current ranked opportunities returned by reverse search" />
        <Metric label="High-score lanes" value={String(metrics.highScore).padStart(2, "0")} detail="Matches scoring 80 or better" />
        <Metric label="Deal records" value={String(metrics.dealCount).padStart(2, "0")} detail="Opportunities already staged in Deal Engine" />
        <Metric label="Seller records" value={String(metrics.sellerCount).padStart(2, "0")} detail="Seller-side records not fully converted yet" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          eyebrow="Search Form"
          title="Buyer criteria"
          description="Enter the buyer's lane, geography, pricing, and posture. The reverse-search engine will rank the best current opportunities already inside Blackspire."
        >
          <form onSubmit={runSearch} className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <input value={criteria.buyerName ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, buyerName: event.target.value }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Buyer name" />
              <input value={criteria.buyerGroup ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, buyerGroup: event.target.value }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Buyer group" />
              <input value={criteria.targetCounty ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, targetCounty: event.target.value }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Target county" />
              <input value={criteria.targetCity ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, targetCity: event.target.value }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Target city" />
              <input value={Array.isArray(criteria.targetZipCodes) ? criteria.targetZipCodes.join(", ") : ""} onChange={(event) => setCriteria((current) => ({ ...current, targetZipCodes: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Target zip codes (comma separated)" />
              <input value={criteria.propertyType ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, propertyType: event.target.value }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Property type" />
              <input value={criteria.minBeds ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, minBeds: event.target.value ? Number(event.target.value) : null }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Min beds" />
              <input value={criteria.maxPrice ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, maxPrice: event.target.value ? Number(event.target.value) : null }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Max price" />
              <input value={criteria.minimumArvSpread ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, minimumArvSpread: event.target.value ? Number(event.target.value) : null }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Minimum ARV spread" />
              <input value={criteria.preferredRadius ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, preferredRadius: event.target.value ? Number(event.target.value) : null }))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Preferred radius (miles)" />
              <select value={criteria.buyerProfileType ?? "unknown"} onChange={(event) => setCriteria((current) => ({ ...current, buyerProfileType: event.target.value as BuyerReverseSearchCriteria["buyerProfileType"] }))} className="brand-input px-3 py-3 text-sm outline-none">
                <option value="unknown">Unknown profile</option>
                <option value="cash_buyer">Cash buyer</option>
                <option value="landlord">Landlord</option>
                <option value="flipper">Flipper</option>
                <option value="hedge_fund">Hedge fund</option>
              </select>
              <label className="flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                <input type="checkbox" checked={Boolean(criteria.activeOnly)} onChange={(event) => setCriteria((current) => ({ ...current, activeOnly: event.target.checked }))} />
                Active opportunities only
              </label>
            </div>

            <textarea value={criteria.buyBoxNotes ?? ""} onChange={(event) => setCriteria((current) => ({ ...current, buyBoxNotes: event.target.value }))} className="brand-input min-h-28 w-full px-3 py-3 text-sm outline-none" placeholder="Buy box notes" />

            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={loading} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                {loading ? "Running reverse search..." : "Run reverse search"}
              </button>
              <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Back to buyer command
              </Link>
            </div>
          </form>
        </Panel>

        <Panel
          eyebrow="Ranked opportunities"
          title="Matches"
          description="The results blend seller motivation, location fit, spread quality, current deal posture, and buyer-demand overlap into one ranked surface."
        >
          <div className="space-y-4">
            {error ? (
              <div className="brand-card border border-[hsl(0_78%_60%/.24)] p-5 text-sm leading-7 text-[hsl(0_90%_84%)]">
                {error}
              </div>
            ) : null}

            {generatedAt ? (
              <div className="text-xs uppercase tracking-[0.26em] text-[var(--copy-muted)]">
                Last run: {new Date(generatedAt).toLocaleString()}
              </div>
            ) : null}

            {!hasSearched && !loading ? (
              <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
                Run a reverse search to surface seller-side and deal-side opportunities that fit a live buyer box.
              </div>
            ) : null}

            {loading ? (
              <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
                Scanning Seller Engine and Deal Engine for the strongest buyer-aligned opportunities.
              </div>
            ) : null}

            {hasSearched && !loading && matches.length === 0 && !error ? (
              <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
                No matching opportunities found yet.
              </div>
            ) : null}

            {matches.map((match) => (
              <div key={match.id} className="brand-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={match.matchScore >= 80 ? "good" : match.matchScore >= 60 ? "active" : "warn"} label={`match ${match.matchScore}`} />
                      <StatusPill tone={match.sourceType === "deal" ? "good" : "neutral"} label={match.sourceType === "deal" ? "deal record" : "seller lead"} />
                    </div>
                    <h4 className="mt-3 text-xl font-semibold text-white">{match.propertyAddress}</h4>
                    <p className="mt-1 text-sm text-[var(--copy-soft)]">
                      {match.city}, {match.county} {match.zip}
                    </p>
                  </div>

                  <Link href={match.link} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition">
                    {match.sourceType === "deal" ? "Open Deal Engine" : "Open Seller Queue"}
                  </Link>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Estimated ARV</div>
                    <div className="brand-accent-text mt-2 text-xl font-semibold">{formatCurrency(match.estimatedArv)}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Estimated MAO</div>
                    <div className="mt-2 text-xl font-semibold text-white">{formatCurrency(match.estimatedMao)}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Motivation</div>
                    <div className="mt-2 text-xl font-semibold text-white">{match.motivationScore}</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Recommended next action</div>
                    <p className="mt-2 text-sm leading-7 text-[var(--copy-soft)]">{match.recommendedAction}</p>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Match reasons</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {match.matchReasons.map((reason) => (
                        <span key={reason} className="rounded-full border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-3 py-2 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)]">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </BuyerShell>
  );
}
