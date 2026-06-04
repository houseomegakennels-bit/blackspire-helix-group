"use client";

import { useState, type FormEvent } from "react";

export function DealRoomInterestForm({
  slug,
  submitLabel,
}: {
  slug: string;
  submitLabel: string;
}) {
  const [investorName, setInvestorName] = useState("");
  const [investorEmail, setInvestorEmail] = useState("");
  const [interestType, setInterestType] = useState("Interested");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          investorName,
          investorEmail,
          interestType,
          notes,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Interest submission failed.");
      setStatus(payload.message ?? "Interest submitted.");
      setInvestorName("");
      setInvestorEmail("");
      setInterestType("Interested");
      setNotes("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Interest submission failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <form onSubmit={submit} className="brand-card p-5">
      <div className="text-lg font-semibold text-white">{submitLabel}</div>
      <div className="mt-4 grid gap-3">
        <input value={investorName} onChange={(event) => setInvestorName(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Investor name" required />
        <input value={investorEmail} onChange={(event) => setInvestorEmail(event.target.value)} type="email" className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Investor email" required />
        <select value={interestType} onChange={(event) => setInterestType(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none">
          <option>Interested</option>
          <option>Request Walkthrough</option>
          <option>Need More Info</option>
          <option>Pass</option>
        </select>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="brand-input min-h-28 w-full px-3 py-3 text-sm outline-none" placeholder="Notes, timing, proof-of-funds, or walkthrough questions" />
        <button type="submit" disabled={working} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
          {working ? "Sending..." : submitLabel}
        </button>
        {status ? <div className="text-sm text-[var(--copy-soft)]">{status}</div> : null}
      </div>
    </form>
  );
}
