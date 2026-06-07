"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type NexusTraceActionProps = {
  leadId: string;
  currentPhone: string;
  currentEmail: string;
  currentStatus: string;
  contactProfileHref?: string;
  compact?: boolean;
};

type TraceResponsePayload = {
  ok?: boolean;
  error?: string;
  result?: {
    primary_phone?: string | null;
    primary_email?: string | null;
    contact_confidence_score?: number;
    skip_trace_status?: string;
  };
};

function hasStoredContact(value: string) {
  return value.trim() && value !== "Not captured";
}

export function NexusTraceAction({
  leadId,
  currentPhone,
  currentEmail,
  currentStatus,
  contactProfileHref,
  compact = false,
}: NexusTraceActionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const hasContact = hasStoredContact(currentPhone) || hasStoredContact(currentEmail);
  const buttonLabel = isPending ? "Tracing..." : hasContact ? "Refresh Trace" : "Run Trace";

  async function runTrace() {
    setMessage(null);

    try {
      const response = await fetch("/api/nexus/trace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ leadId }),
      });

      const payload = (await response.json()) as TraceResponsePayload;
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Tracerfy run failed.");
      }

      const phone = payload.result.primary_phone?.trim();
      const email = payload.result.primary_email?.trim();
      const confidence = payload.result.contact_confidence_score ?? 0;
      const outcome =
        phone || email
          ? `Trace complete. ${phone ? `Phone ${phone}` : "No phone"}, ${email ? `email ${email}` : "no email"}, confidence ${confidence}.`
          : `Trace returned ${payload.result.skip_trace_status ?? "no match"}.`;

      setMessage(outcome);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tracerfy run failed.");
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runTrace()}
          disabled={isPending}
          className="brand-button inline-flex px-3 py-2 text-xs uppercase tracking-[0.18em] transition disabled:opacity-60"
        >
          {buttonLabel}
        </button>
        {contactProfileHref ? (
          <Link
            href={contactProfileHref}
            className="brand-button inline-flex px-3 py-2 text-xs uppercase tracking-[0.18em] transition"
          >
            View Contact Profile
          </Link>
        ) : null}
      </div>
      {message ? (
        <div className="rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-3 py-2 text-xs leading-6 text-[var(--copy-soft)]">
          {message}
        </div>
      ) : (
        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">
          Current status: {currentStatus}
        </div>
      )}
    </div>
  );
}
