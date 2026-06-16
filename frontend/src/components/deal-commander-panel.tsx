"use client";

import { useCallback, useEffect, useState } from "react";

import { Panel, StatusPill } from "@/components/buyer-shell";
import type { DealCommanderInsight } from "@/lib/deal-engine-server";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function priorityTone(priority: DealCommanderInsight["priority"]) {
  if (priority === "High") return "warn";
  if (priority === "Medium") return "active";
  return "neutral";
}

async function fetchCommanderInsight(dealId: string) {
  const response = await fetch("/api/deal-engine/commander", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    insight?: DealCommanderInsight;
  };

  if (!response.ok || !payload.ok || !payload.insight) {
    throw new Error(payload.error ?? "Commander insight generation failed.");
  }

  return payload.insight;
}

export function DealCommanderPanel({
  dealId,
  initialInsight,
}: {
  dealId: string;
  initialInsight: DealCommanderInsight | null;
}) {
  const [insight, setInsight] = useState(initialInsight);
  const [loading, setLoading] = useState(!initialInsight);
  const [error, setError] = useState<string | null>(null);

  const loadInsight = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setInsight(await fetchCommanderInsight(dealId));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Commander insight generation failed.");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    if (insight) {
      return;
    }

    let active = true;

    async function bootstrapInsight() {
      try {
        const nextInsight = await fetchCommanderInsight(dealId);

        if (!active) {
          return;
        }

        setInsight(nextInsight);
        setError(null);
      } catch (caughtError) {
        if (!active) {
          return;
        }

        setError(caughtError instanceof Error ? caughtError.message : "Commander insight generation failed.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void bootstrapInsight();

    return () => {
      active = false;
    };
  }, [dealId, insight]);

  return (
    <Panel
      eyebrow="Deal Commander"
      title="Command-level recommendation"
      description="A tactical next-move layer that reads the deal posture, margin, contact readiness, and buyer fit before the operator commits the next move."
    >
      <div className="grid gap-4">
        <div className="brand-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={insight ? priorityTone(insight.priority) : "neutral"}
              label={insight ? `${insight.priority} priority` : "awaiting insight"}
            />
            {insight ? (
              <StatusPill
                tone={insight.confidenceScore >= 75 ? "good" : insight.confidenceScore >= 55 ? "active" : "warn"}
                label={`confidence ${insight.confidenceScore}`}
              />
            ) : null}
            {insight ? (
              <StatusPill
                tone={insight.generationMode === "ai" ? "good" : "neutral"}
                label={insight.generationMode === "ai" ? "ai-assisted" : "rules-based"}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadInsight()}
              disabled={loading}
              className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
            >
              {insight ? "Refresh Insight" : "Generate Commander Insight"}
            </button>
          </div>
        </div>

        {loading && !insight ? (
          <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
            Deal Commander is reading underwriting, contact posture, and buyer fit to assemble the next move.
          </div>
        ) : null}

        {error && !insight ? (
          <div className="brand-card border border-[hsl(0_78%_60%/.24)] p-6 text-sm leading-7 text-[hsl(0_90%_84%)]">
            {error}
          </div>
        ) : null}

        {!loading && !insight && !error ? (
          <div className="brand-card p-6 text-sm leading-7 text-[var(--copy-soft)]">
            No commander insight has been generated for this deal yet.
          </div>
        ) : null}

        {error && insight ? (
          <div className="rounded-[18px] border border-[hsl(0_78%_60%/.2)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[hsl(0_90%_84%)]">
            {error}
          </div>
        ) : null}

        {insight ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Suggested next action
                </div>
                <div className="mt-3 text-lg font-semibold text-white">{insight.suggestedNextAction}</div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Estimated MAO</div>
                    <div className="brand-accent-text mt-2 text-xl font-semibold">{formatCurrency(insight.estimatedMao)}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Offer low</div>
                    <div className="mt-2 text-xl font-semibold text-white">{formatCurrency(insight.offerRangeLow)}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Offer high</div>
                    <div className="mt-2 text-xl font-semibold text-white">{formatCurrency(insight.offerRangeHigh)}</div>
                  </div>
                </div>
              </div>

              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  Risk warnings
                </div>
                <div className="mt-3 space-y-3">
                  {insight.riskWarnings.length ? (
                    insight.riskWarnings.map((warning) => (
                      <div
                        key={warning}
                        className="rounded-[18px] border border-[hsl(0_78%_60%/.14)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]"
                      >
                        {warning}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm leading-6 text-[var(--copy-soft)]">
                      No critical risk flags are currently blocking operator action.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Negotiation angle</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{insight.negotiationAngle}</p>
              </div>
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Seller pain point hypothesis</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{insight.sellerPainPointHypothesis}</p>
              </div>
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Buyer fit summary</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{insight.buyerFitSummary}</p>
              </div>
              <div className="brand-card p-5">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Disposition strategy</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{insight.dispositionStrategy}</p>
              </div>
              <div className="brand-card p-5 md:col-span-2 xl:col-span-2">
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">Follow-up recommendation</div>
                <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">{insight.followUpRecommendation}</p>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
