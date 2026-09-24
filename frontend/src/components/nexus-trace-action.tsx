import Link from "next/link";

type NexusTraceActionProps = {
  leadId: string;
  currentPhone: string;
  currentEmail: string;
  currentStatus: string;
  contactProfileHref?: string;
  compact?: boolean;
};

export function NexusTraceAction({
  currentStatus,
  contactProfileHref,
  compact = false,
}: NexusTraceActionProps) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {contactProfileHref ? (
        <Link
          href={contactProfileHref}
          className="brand-button inline-flex px-3 py-2 text-xs uppercase tracking-[0.18em] transition"
        >
          View Contact Profile
        </Link>
      ) : null}
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--copy-muted)]">
        Current status: {currentStatus}
      </div>
      <p className="text-xs text-[var(--copy-soft)]">Nexus is available for status review. Direct tracing is retired.</p>
    </div>
  );
}
