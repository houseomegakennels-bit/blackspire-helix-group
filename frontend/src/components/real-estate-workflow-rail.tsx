import Link from "next/link";

type WorkflowStage = {
  id: "harvester" | "seller" | "nexus" | "deal" | "buyer";
  label: string;
  href: string;
  action: string;
  detail: string;
};

const stages: WorkflowStage[] = [
  {
    id: "harvester",
    label: "Add property",
    href: "/workspace/harvester",
    action: "Add a listing or lead",
    detail: "Ingest marketplace posts, screenshots, flyers, PDFs, and pasted deal chatter.",
  },
  {
    id: "seller",
    label: "Seller leads",
    href: "/seller-engine",
    action: "Find and qualify",
    detail: "Source, score, and organize motivated seller leads.",
  },
  {
    id: "nexus",
    label: "Contacts",
    href: "/workspace/nexus",
    action: "Check contact details",
    detail: "Review contact sources and confirm who can make the selling decision.",
  },
  {
    id: "deal",
    label: "Property workspace",
    href: "/workspace/deal-engine",
    action: "Review, offer and close",
    detail: "Research the property, run numbers, review contracts and track closing.",
  },
  {
    id: "buyer",
    label: "Buyer contacts",
    href: "/workspace/buyer-engine",
    action: "Find potential buyers",
    detail: "Review buyer criteria, prepare outreach and track responses.",
  },
];

export function RealEstateWorkflowRail({
  active,
  compact = false,
}: {
  active: WorkflowStage["id"];
  compact?: boolean;
}) {
  return (
    <div className="brand-card mt-5 p-4">
      <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
        Real Estate Workflow
      </div>
      <div className={compact ? "mt-3 grid gap-2" : "mt-3 space-y-2"}>
        {stages.map((stage, index) => {
          const current = stage.id === active;
          return (
            <Link
              key={stage.id}
              href={stage.href}
              aria-current={current ? "page" : undefined}
              className={`block min-h-11 rounded-[14px] border px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)] transition hover:-translate-y-[1px] hover:border-[var(--line-strong)] ${
                current
                  ? "border-[var(--line-strong)] bg-[var(--project-surface)] text-white"
                  : "border-[var(--line)] bg-[hsl(0_0%_100%/.02)] text-[var(--copy-soft)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">
                  {String(index + 1).padStart(2, "0")} / {stage.label}
                </span>
                {current ? (
                  <span className="rounded-full border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--gold-soft)]">
                    current section
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm font-semibold text-white">{stage.action}</div>
              {!compact ? <div className="mt-1 text-xs leading-5 text-[var(--copy-soft)]">{stage.detail}</div> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
