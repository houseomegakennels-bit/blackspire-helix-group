"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Metric, Panel, StatusPill } from "@/components/buyer-shell";
import { DealEngineShell } from "@/components/deal-engine-shell";
import type { DealEngineDealDetail } from "@/lib/deal-engine-server";

function statusTone(status: string) {
  if (status === "Negotiating") return "warn";
  if (status === "Offer Ready" || status === "Under Contract") return "good";
  return "neutral";
}

export function DealEngineDealDetailView({
  dealId,
  detail,
}: {
  dealId: string;
  detail: DealEngineDealDetail;
}) {
  const router = useRouter();
  const [contractType, setContractType] = useState(
    detail.contractDraft?.contractType ?? "Assignable purchase agreement",
  );
  const [offerLow, setOfferLow] = useState(
    detail.contractDraft?.offerWindow.split(" - ")[0]?.replace(/[^0-9]/g, "") ?? "205000",
  );
  const [offerHigh, setOfferHigh] = useState(
    detail.contractDraft?.offerWindow.split(" - ")[1]?.replace(/[^0-9]/g, "") ?? "214000",
  );
  const [earnestMoney, setEarnestMoney] = useState(
    detail.contractDraft?.earnestMoney.replace(/[^0-9]/g, "") ?? "5000",
  );
  const [selectedBuyerSignalId, setSelectedBuyerSignalId] = useState(detail.buyerSignals[0]?.id ?? "");
  const [propertyNotes, setPropertyNotes] = useState(detail.packet.propertyNotes);
  const [investorSummary, setInvestorSummary] = useState(detail.packet.investorSummary);
  const [buyerEmailBlast, setBuyerEmailBlast] = useState(detail.packet.buyerEmailBlast);
  const [buyerSmsAlert, setBuyerSmsAlert] = useState(detail.packet.buyerSmsAlert);
  const [contactInstructions, setContactInstructions] = useState(detail.packet.contactInstructions);
  const [deadlineToSubmitOffer, setDeadlineToSubmitOffer] = useState(detail.packet.deadlineToSubmitOffer);
  const [comps, setComps] = useState(detail.packet.comps.join("\n"));
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState<"contract" | "buyer" | "packet" | null>(null);

  async function saveContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("contract");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/save-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          contractType,
          offerLow: Number(offerLow),
          offerHigh: Number(offerHigh),
          earnestMoney: Number(earnestMoney),
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Contract save failed.");
      setStatus(payload.message ?? "Contract posture saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Contract save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function createBuyerDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("buyer");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/create-buyer-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          buyerSignalId: selectedBuyerSignalId,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Buyer draft failed.");
      setStatus(payload.message ?? "Buyer draft created.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Buyer draft failed.");
    } finally {
      setWorking(null);
    }
  }

  async function savePacket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("packet");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/save-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          propertyNotes,
          investorSummary,
          buyerEmailBlast,
          buyerSmsAlert,
          contactInstructions,
          deadlineToSubmitOffer,
          comps: comps.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Packet save failed.");
      setStatus(payload.message ?? "Deal packet saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Packet save failed.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <DealEngineShell>
      <header className="brand-panel overflow-hidden px-6 py-7">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Deal Workstation</p>
              <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                {detail.lead.propertyAddress}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.lead.ownerName} / {detail.lead.county} County. This is the live workbench for underwriting posture, contract movement, and buyer activation around deal {dealId}.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/workspace/deal-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Back to command deck
              </Link>
              <Link href={`/workspace/deal-engine/${encodeURIComponent(dealId)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open packet view
              </Link>
              <a href={`/api/deal-engine/${encodeURIComponent(dealId)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Download PDF packet
              </a>
              <Link href={`/deal-room/${encodeURIComponent(detail.room.slug)}`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open external deal room
              </Link>
              <Link href="/seller-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Seller Engine
              </Link>
              <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Buyer Engine
              </Link>
            </div>
          </div>

          <div className="grid gap-4 content-start">
            <div className="brand-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-white">Deal posture</div>
                <StatusPill tone={statusTone(detail.lead.status)} label={detail.lead.status.toLowerCase()} />
              </div>
              <div className="mt-4 space-y-3 text-sm text-[var(--copy-soft)]">
                <div>MAO: <span className="font-semibold text-white">{detail.lead.mao}</span></div>
                <div>Assignment target: <span className="font-semibold text-white">{detail.lead.assignmentFee}</span></div>
                <div>Exit strategy: <span className="font-semibold text-white">{detail.lead.exitStrategy}</span></div>
                <div>Next move: <span className="font-semibold text-white">{detail.lead.nextAction}</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Motivation Score" value={String(detail.lead.motivationScore)} detail="Seller urgency and context from upstream intelligence" />
        <Metric label="Buyer Matches" value={String(detail.buyerSignals.length).padStart(2, "0")} detail="Relevant Buyer Engine signals for this county lane" />
        <Metric label="Saved Drafts" value={String(detail.relatedDrafts.length).padStart(2, "0")} detail="Existing outreach drafts already connected to this market" />
        <Metric label="Contract Mode" value={detail.contractDraft ? "Live" : "Draft"} detail="Contract posture assembled from the current deal snapshot" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Seller Context"
          title="Acquisition brief"
          description="Everything the acquisitions side should carry from Seller Engine into the live conversation."
        >
          <div className="space-y-4">
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Current seller summary</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.sellerSignal?.summary ?? "Seller intelligence summary is not available yet."}
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Recommended handoff action</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.sellerSignal?.recommendedAction ?? detail.lead.nextAction}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Contract Console"
          title="Save underwriting and terms"
          description="Adjust the contract lane directly from the deal workstation and push the updated posture back into Deal Engine tables."
        >
          <form onSubmit={saveContract} className="grid gap-4">
            <input value={contractType} onChange={(event) => setContractType(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Contract type" />
            <div className="grid gap-3 md:grid-cols-3">
              <input value={offerLow} onChange={(event) => setOfferLow(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Offer low" />
              <input value={offerHigh} onChange={(event) => setOfferHigh(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Offer high" />
              <input value={earnestMoney} onChange={(event) => setEarnestMoney(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Earnest money" />
            </div>
            <button type="submit" disabled={working === "contract"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "contract" ? "Saving..." : "Save contract posture"}
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Buyer Activation"
          title="Create and review investor drafts"
          description="Select a buyer signal from Buyer Engine, generate a disposition draft, and keep the artifact trail attached to this deal."
        >
          <form onSubmit={createBuyerDraft} className="grid gap-4">
            <select
              value={selectedBuyerSignalId}
              onChange={(event) => setSelectedBuyerSignalId(event.target.value)}
              className="brand-input w-full px-3 py-3 text-sm outline-none"
            >
              {detail.buyerSignals.map((signal) => (
                <option key={signal.id} value={signal.id}>
                  {signal.buyerName} / {signal.market} / {signal.propertyType}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!selectedBuyerSignalId || working === "buyer"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "buyer" ? "Drafting..." : "Create buyer outreach draft"}
            </button>
          </form>

          <div className="mt-6 space-y-4">
            {detail.buyerSignals.map((signal) => (
              <div key={signal.id} className="brand-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">{signal.buyerName}</div>
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">{signal.market} / {signal.propertyType}</div>
                  </div>
                  <div className="flex gap-2">
                    <StatusPill tone="good" label={`score ${signal.score}`} />
                    <StatusPill tone="warn" label={`${signal.purchaseCount} buys`} />
                  </div>
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{signal.outreachAngle}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Draft Ledger"
          title="Saved outreach artifacts"
          description="These are the saved buyer drafts already tied to the same buyer-market lane as this deal."
        >
          <div className="space-y-4">
            {detail.relatedDrafts.length ? (
              detail.relatedDrafts.map((draft) => (
                <div key={draft.id} className="brand-card p-4">
                  <div className="text-base font-semibold text-white">{draft.buyerName}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{draft.subject}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{new Date(draft.createdAt).toLocaleString()}</div>
                  <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{draft.angle}</div>
                  <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--copy-soft)]">{draft.body}</pre>
                </div>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No saved buyer drafts are linked to this deal lane yet.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Disposition Packet"
        title="Edit buyer-facing packet sections"
        description="Shape the comps, property notes, investor summary, and buyer-facing copy directly from this workstation."
      >
        <form onSubmit={savePacket} className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4">
            <textarea value={propertyNotes} onChange={(event) => setPropertyNotes(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="Property notes" />
            <textarea value={investorSummary} onChange={(event) => setInvestorSummary(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="Investor summary" />
            <textarea value={comps} onChange={(event) => setComps(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="One comp per line" />
          </div>
          <div className="space-y-4">
            <input value={deadlineToSubmitOffer} onChange={(event) => setDeadlineToSubmitOffer(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Deadline to submit offer" />
            <textarea value={contactInstructions} onChange={(event) => setContactInstructions(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Contact instructions" />
            <textarea value={buyerEmailBlast} onChange={(event) => setBuyerEmailBlast(event.target.value)} className="brand-input min-h-28 w-full px-3 py-3 text-sm outline-none" placeholder="Buyer email blast" />
            <textarea value={buyerSmsAlert} onChange={(event) => setBuyerSmsAlert(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Buyer SMS alert" />
            <button type="submit" disabled={working === "packet"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "packet" ? "Saving packet..." : "Save disposition packet"}
            </button>
          </div>
        </form>
      </Panel>

      {status ? (
        <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[var(--copy-soft)]">
          {status}
        </div>
      ) : null}
    </DealEngineShell>
  );
}
