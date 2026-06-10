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
    label: "Harvester",
    href: "/workspace/harvester",
    action: "Capture opportunity",
    detail: "Ingest marketplace posts, screenshots, flyers, PDFs, and pasted deal chatter.",
  },
  {
    id: "seller",
    label: "Seller",
    href: "/seller-engine",
    action: "Find and qualify",
    detail: "Source, score, and organize motivated seller leads.",
  },
  {
    id: "nexus",
    label: "Nexus",
    href: "/workspace/nexus",
    action: "Resolve contact",
    detail: "Run skip trace and confirm the decision-maker lane.",
  },
  {
    id: "deal",
    label: "Deal",
    href: "/workspace/deal-engine",
    action: "Execute deal",
    detail: "Underwrite, contract, package, coordinate, and close.",
  },
  {
    id: "buyer",
    label: "Buyer",
    href: "/workspace/buyer-engine",
    action: "Activate exit",
    detail: "Match buyers, launch outreach, and track disposition.",
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
              className={`block rounded-[14px] border px-3 py-3 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)] ${
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
                    active
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
