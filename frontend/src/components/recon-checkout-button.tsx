"use client";

import { useState } from "react";

export function ReconCheckoutButton({
  planId,
  label,
  highlighted,
}: {
  planId: string;
  label: string;
  highlighted?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recon-engine/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || "Checkout is unavailable right now.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout is unavailable right now.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className={`${highlighted ? "recon-button" : "brand-button"} inline-flex w-full justify-center px-5 py-3 text-sm uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {loading ? "Redirecting..." : label}
      </button>
      {error ? <p className="mt-2 text-center text-xs text-amber-300">{error}</p> : null}
    </div>
  );
}
