"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
}: {
  sellerSignals: DealEngineSellerSignal[];
  buyerSignals: DealEngineBuyerSignal[];
  contractDrafts: DealEngineContractDraft[];
}) {
  const router = useRouter();
  const [selectedSellerLeadId, setSelectedSellerLeadId] = useState(sellerSignals[0]?.id ?? "");
  const [selectedContractDealId, setSelectedContractDealId] = useState(contractDrafts[0]?.dealId ?? "");
  const [selectedBuyerDealId, setSelectedBuyerDealId] = useState(contractDrafts[0]?.dealId ?? "");
  const [selectedBuyerSignalId, setSelectedBuyerSignalId] = useState(buyerSignals[0]?.id ?? "");
  const [offerLow, setOfferLow] = useState("205000");
  const [offerHigh, setOfferHigh] = useState("214000");
  const [earnestMoney, setEarnestMoney] = useState("5000");
  const [contractType, setContractType] = useState("Assignable purchase agreement");
  const [status, setStatus] = useState<string | null>(null);
  const [workingLane, setWorkingLane] = useState<string | null>(null);

  async function submitJson(url: string, body: Record<string, unknown>, lane: string) {
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
      <form onSubmit={handoffSellerLead} className="brand-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Seller handoff</div>
          <StatusPill tone="good" label="seller -> deal" />
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Seller lead</span>
            <select
              value={selectedSellerLeadId}
              onChange={(event) => setSelectedSellerLeadId(event.target.value)}
              className="brand-input mt-2 w-full px-3 py-3 text-sm outline-none"
            >
              {sellerSignals.map((signal) => (
                <option key={signal.id} value={signal.id}>
                  {signal.propertyAddress}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!selectedSellerLeadId || workingLane === "seller"}
            className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
          >
            {workingLane === "seller" ? "Building deal..." : "Create deal from seller lead"}
          </button>
        </div>
      </form>

      <form onSubmit={saveContractTerms} className="brand-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Contract posture</div>
          <StatusPill tone="warn" label="deal -> contract" />
        </div>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Deal</span>
            <select
              value={selectedContractDealId}
              onChange={(event) => setSelectedContractDealId(event.target.value)}
              className="brand-input mt-2 w-full px-3 py-3 text-sm outline-none"
            >
              {contractDrafts.map((draft) => (
                <option key={draft.dealId} value={draft.dealId}>
                  {draft.propertyAddress}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Contract type</span>
            <input value={contractType} onChange={(event) => setContractType(event.target.value)} className="brand-input mt-2 w-full px-3 py-3 text-sm outline-none" />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <input value={offerLow} onChange={(event) => setOfferLow(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Offer low" />
            <input value={offerHigh} onChange={(event) => setOfferHigh(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Offer high" />
            <input value={earnestMoney} onChange={(event) => setEarnestMoney(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="EMD" />
          </div>
          <button
            type="submit"
            disabled={!selectedContractDealId || workingLane === "contract"}
            className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
          >
            {workingLane === "contract" ? "Saving..." : "Save contract terms"}
          </button>
        </div>
      </form>

      <form onSubmit={createBuyerDraft} className="brand-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Buyer outreach</div>
          <StatusPill tone="active" label="deal -> buyer" />
        </div>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Deal</span>
            <select
              value={selectedBuyerDealId}
              onChange={(event) => setSelectedBuyerDealId(event.target.value)}
              className="brand-input mt-2 w-full px-3 py-3 text-sm outline-none"
            >
              {contractDrafts.map((draft) => (
                <option key={draft.dealId} value={draft.dealId}>
                  {draft.propertyAddress}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Buyer signal</span>
            <select
              value={selectedBuyerSignalId}
              onChange={(event) => setSelectedBuyerSignalId(event.target.value)}
              className="brand-input mt-2 w-full px-3 py-3 text-sm outline-none"
            >
              {buyerSignals.map((signal) => (
                <option key={signal.id} value={signal.id}>
                  {signal.buyerName} / {signal.market}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!selectedBuyerDealId || !selectedBuyerSignalId || workingLane === "buyer"}
            className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
          >
            {workingLane === "buyer" ? "Drafting..." : "Create buyer outreach draft"}
          </button>
        </div>
      </form>

      {status ? (
        <div className="xl:col-span-3 rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[var(--copy-soft)]">
          {status}
        </div>
      ) : null}
    </div>
  );
}
