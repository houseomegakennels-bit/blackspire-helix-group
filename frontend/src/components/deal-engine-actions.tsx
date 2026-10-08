"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { InvestmentAmountField } from "@/components/investment-amount-field";

import { StatusPill } from "@/components/buyer-shell";
import type {
  DealEngineBuyerSignal,
  DealEngineContractDraft,
  DealEngineSellerSignal,
} from "@/lib/deal-engine";

export function DealEngineActions({
  sellerSignals,
  buyerSignals,
  contractDrafts,
  persistence,
}: {
  sellerSignals: DealEngineSellerSignal[];
  buyerSignals: DealEngineBuyerSignal[];
  contractDrafts: DealEngineContractDraft[];
  persistence: {
    ready: boolean;
    mode: "live" | "schema-missing" | "env-missing";
    detail: string;
  };
}) {
  const router = useRouter();
  const [selectedSellerLeadId, setSelectedSellerLeadId] = useState(sellerSignals[0]?.id ?? "");
  const [selectedContractDealId, setSelectedContractDealId] = useState(contractDrafts[0]?.dealId ?? "");
  const [selectedBuyerDealId, setSelectedBuyerDealId] = useState(contractDrafts[0]?.dealId ?? "");
  const [selectedBuyerSignalId, setSelectedBuyerSignalId] = useState(buyerSignals[0]?.id ?? "");
  const [offerLow, setOfferLow] = useState("");
  const [offerHigh, setOfferHigh] = useState("");
  const [earnestMoney, setEarnestMoney] = useState("");
  const [contractType, setContractType] = useState("Assignable purchase agreement");
  const [status, setStatus] = useState<string | null>(null);
  const [workingLane, setWorkingLane] = useState<string | null>(null);
  const writesBlocked = !persistence.ready;

  async function submitJson(url: string, body: Record<string, unknown>, lane: string) {
    if (writesBlocked) {
      setStatus(persistence.detail);
      return;
    }

    setWorkingLane(lane);
    setStatus(null);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; message?: string; dealId?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Deal Engine action failed.");
      }
      setStatus(payload.message ?? "Action completed.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deal Engine action failed.");
    } finally {
      setWorkingLane(null);
    }
  }

  function handoffSellerLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitJson(
      "/api/deal-engine/create-from-seller",
      { sellerLeadId: selectedSellerLeadId },
      "seller",
    );
  }

  function saveContractTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!offerLow.trim() || !offerHigh.trim() || !earnestMoney.trim()) { setStatus("Enter proposed offer amounts and the deposit for this property before saving terms."); return; }
    void submitJson(
      "/api/deal-engine/save-contract",
      {
        dealId: selectedContractDealId,
        contractType,
        offerLow: Number(offerLow),
        offerHigh: Number(offerHigh),
        earnestMoney: Number(earnestMoney),
      },
      "contract",
    );
  }

  function createBuyerDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitJson(
      "/api/deal-engine/create-buyer-draft",
      {
        dealId: selectedBuyerDealId,
        buyerSignalId: selectedBuyerSignalId,
      },
      "buyer",
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {writesBlocked ? (
        <div className="xl:col-span-3 rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[var(--copy-soft)]">
          Deal Engine write actions are paused. {persistence.detail}
        </div>
      ) : null}

      <form onSubmit={handoffSellerLead} className="brand-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Seller handoff</div>
          <StatusPill tone={writesBlocked ? "warn" : "good"} label={writesBlocked ? "write blocked" : "seller -> deal"} />
        </div>
        <div className="mt-4 space-y-3">
          {sellerSignals.length ? (
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Seller lead</span>
              <select
                value={selectedSellerLeadId}
                onChange={(event) => setSelectedSellerLeadId(event.target.value)}
                className="brand-input mt-2 w-full px-3 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)]"
              >
                {sellerSignals.map((signal) => (
                  <option key={signal.id} value={signal.id}>
                    {signal.propertyAddress}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
              No live seller leads are available for Deal Engine handoff.
            </div>
          )}
          <button
            type="submit"
            disabled={!selectedSellerLeadId || workingLane === "seller" || writesBlocked}
            className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
          >
            {workingLane === "seller" ? "Building deal..." : "Create deal from seller lead"}
          </button>
        </div>
      </form>

      <form onSubmit={saveContractTerms} className="brand-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Proposed contract terms</div>
          <StatusPill tone={writesBlocked ? "warn" : "warn"} label={writesBlocked ? "write blocked" : "deal -> contract"} />
        </div>
        <div className="mt-4 grid gap-3">
          {contractDrafts.length ? (
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Deal</span>
              <select
                value={selectedContractDealId}
                onChange={(event) => { setSelectedContractDealId(event.target.value); setOfferLow(""); setOfferHigh(""); setEarnestMoney(""); }}
                className="brand-input mt-2 w-full px-3 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)]"
              >
                {contractDrafts.map((draft) => (
                  <option key={draft.dealId} value={draft.dealId}>
                    {draft.propertyAddress}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
              No live deals are available for contract posture updates.
            </div>
          )}
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Contract type</span>
            <input value={contractType} onChange={(event) => setContractType(event.target.value)} className="brand-input mt-2 w-full px-3 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)]" />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <InvestmentAmountField label="Offer range — lower amount" help="Enter your own proposed amount. Saving a draft does not send an offer." value={offerLow} onChange={setOfferLow} required />
            <InvestmentAmountField label="Offer range — upper amount" help="Enter your own upper amount after reviewing the analysis and seller terms." value={offerHigh} onChange={setOfferHigh} required />
            <InvestmentAmountField label="Earnest money deposit" help="Deposit proposed for this property. Enter a confirmed 0 if none; do not guess." value={earnestMoney} onChange={setEarnestMoney} required />
          </div>
          <button
            type="submit"
            disabled={!selectedContractDealId || workingLane === "contract" || writesBlocked}
            className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
          >
            {workingLane === "contract" ? "Saving..." : "Save draft terms"}
          </button>
        </div>
      </form>

      <form onSubmit={createBuyerDraft} className="brand-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Buyer outreach</div>
          <StatusPill tone={writesBlocked ? "warn" : "active"} label={writesBlocked ? "write blocked" : "deal -> buyer"} />
        </div>
        <div className="mt-4 grid gap-3">
          {contractDrafts.length ? (
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Deal</span>
              <select
                value={selectedBuyerDealId}
                onChange={(event) => setSelectedBuyerDealId(event.target.value)}
                className="brand-input mt-2 w-full px-3 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)]"
              >
                {contractDrafts.map((draft) => (
                  <option key={draft.dealId} value={draft.dealId}>
                    {draft.propertyAddress}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
              No live deals are available for buyer outreach drafting.
            </div>
          )}
          {buyerSignals.length ? (
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Buyer signal</span>
              <select
                value={selectedBuyerSignalId}
                onChange={(event) => setSelectedBuyerSignalId(event.target.value)}
                className="brand-input mt-2 w-full px-3 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)]"
              >
                {buyerSignals.map((signal) => (
                  <option key={signal.id} value={signal.id}>
                    {signal.buyerName} / {signal.market}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.02)] px-4 py-3 text-sm text-[var(--copy-soft)]">
              No live buyer records are available for outreach drafting.
            </div>
          )}
          <button
            type="submit"
            disabled={!selectedBuyerDealId || !selectedBuyerSignalId || workingLane === "buyer" || writesBlocked}
            className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
          >
            {workingLane === "buyer" ? "Drafting..." : "Create buyer outreach draft"}
          </button>
        </div>
      </form>

      {status ? (
        <div role="status" aria-live="polite" className="workspace-feedback xl:col-span-3 text-sm">
          {status}
        </div>
      ) : null}
    </div>
  );
}
