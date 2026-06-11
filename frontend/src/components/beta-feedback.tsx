"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "navigation", label: "Navigation confusion" },
  { value: "bug", label: "Bug" },
  { value: "bad_data", label: "Bad data" },
  { value: "missing_feature", label: "Missing feature" },
  { value: "performance", label: "Performance" },
  { value: "other", label: "Other" },
];

export function BetaFeedback() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("navigation");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!message.trim()) {
      setStatus("Please add a message.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/beta/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, pagePath: pathname }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        setStatus(payload.error || "Could not submit.");
        return;
      }
      setStatus("Thanks - feedback sent.");
      setMessage("");
      setTimeout(() => setOpen(false), 1200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 rounded-full border border-[#d6a84f55] bg-black/70 px-4 py-3 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)] backdrop-blur transition hover:border-[#d6a84f] sm:py-2"
        aria-label="Give beta feedback"
      >
        Feedback
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[460px] rounded-[18px] border border-[#d6a84f55] bg-[#0a0805] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Beta feedback</div>
              <button type="button" onClick={() => setOpen(false)} className="text-[var(--copy-muted)] hover:text-white">
                X
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--copy-muted)]">
              Tell us what&apos;s confusing, broken, or missing right where it happened.
            </p>

            <label className="mt-4 block text-xs uppercase tracking-wider text-[var(--copy-muted)]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-[12px] border border-[var(--line)] bg-black/40 px-3 py-2 text-sm text-white outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <label className="mt-4 block text-xs uppercase tracking-wider text-[var(--copy-muted)]">What happened?</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe the issue or idea..."
              className="mt-1 w-full rounded-[12px] border border-[var(--line)] bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-[var(--copy-muted)]"
            />

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--copy-soft)]">{status}</span>
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="rounded-full border border-[#d6a84f] bg-[rgba(214,168,79,0.14)] px-5 py-2 text-xs uppercase tracking-[0.18em] text-[var(--gold-soft)] transition hover:bg-[rgba(214,168,79,0.24)] disabled:opacity-50"
              >
                {busy ? "Sending..." : "Send feedback"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
