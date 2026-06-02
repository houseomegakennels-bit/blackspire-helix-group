import Image from "next/image";
import Link from "next/link";

const navItems = [
  "Dashboard",
  "Lawn Leads",
  "Pipeline",
  "Estimate Queue",
  "Follow-Ups",
  "Outreach Drafts",
  "Import History",
  "Priority Actions",
  "Settings",
] as const;

const metricCards = [
  { value: "3", label: "New Leads", detail: "awaiting triage" },
  { value: "1", label: "Estimate Needed", detail: "AI drafting" },
  { value: "2", label: "Quote Sent", detail: "waiting on reply" },
  { value: "2", label: "Booked Jobs", detail: "this week" },
  { value: "1", label: "Completed Jobs", detail: "last 30 days" },
  { value: "7", label: "Follow-Ups Due", detail: "3 overdue" },
] as const;

const pipelineColumns = [
  { label: "New Lead", count: 0, items: [] },
  { label: "Estimate Needed", count: 1, items: ["Marcus Hill", "Lawn Mowing + Edging"] },
  { label: "Quote Sent", count: 2, items: ["Dana Pierce", "Mulch Install", "Lacey Brooks", "Yard Cleanup"] },
  { label: "Booked", count: 2, items: ["Ron Tipton", "Bush Trimming", "Eli Park", "Weekly Mowing"] },
  { label: "Completed", count: 1, items: ["Tasha Wynn", "Yard Cleanup"] },
  { label: "Lost", count: 0, items: [] },
] as const;

const recentLeads = [
  { name: "Marcus Hill", service: "Lawn Mowing + Edging", address: "412 Oak Ridge Dr, Winston Salem", urgency: "high", estimate: "$145 - $185" },
  { name: "Dana Pierce", service: "Mulch Install", address: "88 Linden Ln, Clemmons", urgency: "medium", estimate: "$320 - $410" },
  { name: "Ron Tipton", service: "Bush Trimming", address: "1207 Reynolda Rd, Winston Salem", urgency: "urgent", estimate: "$280 - $360" },
  { name: "Lacey Brooks", service: "Yard Cleanup", address: "55 Stratford Pl, Winston Salem", urgency: "high", estimate: "$180 - $240" },
] as const;

const priorityActions = [
  "Confirm Wednesday visit — Marcus replied yes, confirm time slot and send ETA.",
  "Send Lacey estimate — storm cleanup quote drafted, review and send.",
  "Owner alert: hedge job booked — add to crew route.",
] as const;

const pricingLogic = [
  "Small city yard mowing: $45-$75",
  "Medium residential yard: $75-$125",
  "Large residential yard: $125-$225",
  "Acreage mowing: usually $75-$150+ per acre depending on terrain and overgrowth",
  "5+ acres: should trigger manual review, do not estimate under $300",
  "10 acres: flag as high-value acreage/commercial job, broadly $750-$1,500+",
  "Overgrowth: can add 25%-100%",
  "Bush trimming: $10-$25 per bush light, $25-$60 per bush heavy",
  "Cleanup / debris / leaves: $150-$600+",
  "Slope, tight access, pets, gates, debris, hauling: increase price or trigger owner review",
  "Recurring service: can reduce per-visit price vs one-time",
] as const;

const activityItems = [
  "New lead captured from website form.",
  "AI assistant rated lead HOT — high urgency.",
  "Preliminary estimate $145-$185 generated.",
  "Owner alert sent via SMS.",
  "Weekly mowing contract booked.",
] as const;

export function HelixLawnCommandHome() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,hsl(135_68%_9%),transparent_36%),linear-gradient(180deg,hsl(148_44%_6%)_0%,hsl(150_44%_5%)_100%)] text-foreground">
      <div className="mx-auto grid min-h-screen max-w-[1660px] gap-6 px-4 py-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-6">
        <aside className="rounded-[28px] border border-[hsl(126_48%_22%/.45)] bg-[hsl(150_42%_7%/.92)] p-5 shadow-[0_24px_80px_hsl(0_0%_0%/.4)]">
          <div className="space-y-4 border-b border-[hsl(126_48%_22%/.35)] pb-5">
            <div className="overflow-hidden rounded-[18px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.9)] p-3">
              <Image
                src="/brand/helix-lawn-command-logo.png"
                alt="Helix Lawn Command logo"
                width={847}
                height={1280}
                className="h-auto w-full object-contain"
              />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.42em] text-[hsl(111_87%_65%)]">
                Command center
              </p>
              <h1 className="mt-3 text-2xl font-semibold text-white">Today at Blackspire</h1>
              <p className="mt-3 text-sm leading-6 text-[hsl(120_16%_72%)]">
                AI assistant is qualifying lawn leads and pricing jobs in real time.
              </p>
            </div>
          </div>

          <nav className="mt-5 space-y-2">
            {navItems.map((item, index) => (
              <div
                key={item}
                className={`rounded-[16px] border px-4 py-3 text-sm uppercase tracking-[0.18em] ${
                  index === 0
                    ? "border-[hsl(126_48%_28%/.55)] bg-[hsl(142_36%_11%/.95)] text-white"
                    : "border-[hsl(126_48%_18%/.4)] bg-[hsl(150_28%_8%/.75)] text-[hsl(120_16%_72%)]"
                }`}
              >
                {item}
              </div>
            ))}
          </nav>

          <div className="mt-6 rounded-[18px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[hsl(111_87%_65%)]">
              <span className="h-2 w-2 rounded-full bg-[hsl(111_87%_65%)] shadow-[0_0_16px_hsl(111_87%_65%/.55)]" />
              AI assistant online
            </div>
            <p className="mt-3 text-sm leading-6 text-[hsl(120_16%_72%)]">
              Capturing and qualifying lawn leads 24/7.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/ecosystem/helix-lawn-command" className="rounded-full border border-[hsl(126_48%_28%/.55)] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white transition hover:bg-[hsl(142_36%_12%)]">
                Return to offer page
              </Link>
            </div>
          </div>
        </aside>

        <section className="space-y-6 rounded-[30px] border border-[hsl(126_48%_18%/.24)] bg-[hsl(150_42%_7%/.62)] p-6 shadow-[0_28px_90px_hsl(0_0%_0%/.34)] backdrop-blur-xl">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.44em] text-[hsl(111_87%_65%)]">Helix Lawn Command</p>
              <h2 className="mt-3 text-5xl font-semibold text-white">Today at Blackspire</h2>
              <p className="mt-3 text-base leading-7 text-[hsl(120_16%_72%)]">
                The old Lovable command-center surface is now preserved inside the repo so the lawn
                offer has a real operational layer behind it.
              </p>
            </div>
            <span className="rounded-full border border-[hsl(126_48%_28%/.55)] bg-[hsl(142_36%_10%/.88)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[hsl(111_87%_65%)]">
              Live
            </span>
          </header>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {metricCards.map((card) => (
              <article key={card.label} className="rounded-[22px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.88)] p-5">
                <div className="text-4xl font-semibold text-white">{card.value}</div>
                <div className="mt-2 text-lg font-medium text-[hsl(120_10%_86%)]">{card.label}</div>
                <div className="mt-2 text-sm text-[hsl(111_68%_54%)]">{card.detail}</div>
              </article>
            ))}
          </section>

          <section className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-3xl font-semibold text-white">Lead Pipeline</h3>
              <span className="text-xs uppercase tracking-[0.24em] text-[hsl(120_16%_72%)]">Drag-style stage view</span>
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-6">
              {pipelineColumns.map((column) => (
                <div key={column.label} className="rounded-[20px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(150_28%_8%/.75)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-[hsl(120_16%_72%)]">{column.label}</div>
                    <div className="text-xs text-[hsl(111_87%_65%)]">{column.count}</div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {column.items.length ? (
                      Array.from({ length: column.items.length / 2 }).map((_, index) => (
                        <div key={`${column.label}-${index}`} className="rounded-[14px] border border-[hsl(126_48%_18%/.25)] bg-[hsl(145_22%_11%/.92)] px-3 py-3">
                          <div className="text-sm font-medium text-white">{column.items[index * 2]}</div>
                          <div className="mt-1 text-xs text-[hsl(120_16%_72%)]">{column.items[index * 2 + 1]}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm italic text-[hsl(120_16%_52%)]">Empty</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <section className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-3xl font-semibold text-white">Recent Lawn Leads</h3>
                <span className="text-sm text-[hsl(111_87%_65%)]">View all →</span>
              </div>
              <div className="mt-5 space-y-3">
                {recentLeads.map((lead) => (
                  <div key={lead.name} className="rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">
                          {lead.name} <span className="font-normal text-[hsl(120_16%_72%)]">· {lead.service}</span>
                        </div>
                        <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">{lead.address}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-[hsl(126_48%_20%/.35)] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[hsl(111_87%_65%)]">
                          {lead.urgency}
                        </span>
                        <span className="text-lg font-semibold text-[hsl(111_87%_65%)]">{lead.estimate}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
                <h3 className="text-3xl font-semibold text-white">Priority Actions</h3>
                <div className="mt-5 space-y-3">
                  {priorityActions.map((action) => (
                    <div key={action} className="rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4 text-sm leading-6 text-[hsl(120_16%_72%)]">
                      {action}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-3xl font-semibold text-white">Realistic Pricing Logic</h3>
                  <span className="rounded-full border border-[hsl(53_72%_38%/.4)] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[hsl(53_84%_64%)]">
                    Owner reference
                  </span>
                </div>
                <div className="mt-4 space-y-3 text-sm leading-7 text-[hsl(120_16%_72%)]">
                  {pricingLogic.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
            <h3 className="text-3xl font-semibold text-white">Activity Stream</h3>
            <div className="mt-5 space-y-4">
              {activityItems.map((item, index) => (
                <div key={item} className="flex gap-4">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-[hsl(111_87%_65%)] shadow-[0_0_18px_hsl(111_87%_65%/.45)]" />
                  <div>
                    <div className="text-base text-white">{item}</div>
                    <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">
                      6/2/2026, 8:{20 + index}:00 AM · {[
                        "lead_captured",
                        "ai_qualified",
                        "estimate_generated",
                        "owner_alert",
                        "job_booked",
                      ][index]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
