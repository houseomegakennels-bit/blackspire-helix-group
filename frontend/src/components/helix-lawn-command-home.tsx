import Image from "next/image";
import Link from "next/link";

import {
  helixLawnPricingLogic,
  type HelixLawnCommandSnapshot,
} from "@/lib/helix-lawn-command-server";

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

export function HelixLawnCommandHome({
  snapshot,
}: {
  snapshot: HelixLawnCommandSnapshot;
}) {
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
                Live lawn leads are now flowing into this workspace from the Helix intake experience.
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
              {snapshot.totalLeadCount
                ? `Tracking ${snapshot.totalLeadCount} live lead${snapshot.totalLeadCount === 1 ? "" : "s"} in this pipeline.`
                : "Waiting for the first live lead to hit the system."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/helix-lawn-command"
                className="rounded-full border border-[hsl(126_48%_28%/.55)] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white transition hover:bg-[hsl(142_36%_12%)]"
              >
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
                The old Lovable command-center surface is now backed by live submissions captured inside
                the repo and persisted through Supabase.
              </p>
            </div>
            <span className="rounded-full border border-[hsl(126_48%_28%/.55)] bg-[hsl(142_36%_10%/.88)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[hsl(111_87%_65%)]">
              Live
            </span>
          </header>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.metricCards.map((card) => (
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
              <span className="text-xs uppercase tracking-[0.24em] text-[hsl(120_16%_72%)]">Live stage view</span>
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-6">
              {snapshot.pipelineColumns.map((column) => (
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
                <span className="text-sm text-[hsl(111_87%_65%)]">{snapshot.totalLeadCount} total</span>
              </div>
              <div className="mt-5 space-y-3">
                {snapshot.recentLeads.length ? (
                  snapshot.recentLeads.map((lead) => (
                    <div key={lead.id} className="rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-white">
                            {lead.name} <span className="font-normal text-[hsl(120_16%_72%)]">· {lead.service}</span>
                          </div>
                          <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">{lead.address}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[hsl(120_16%_52%)]">
                            {lead.stage}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-full border border-[hsl(126_48%_20%/.35)] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[hsl(111_87%_65%)]">
                            {lead.urgency}
                          </span>
                          <span className="text-lg font-semibold text-[hsl(111_87%_65%)]">{lead.estimate}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4 text-sm leading-6 text-[hsl(120_16%_72%)]">
                    No live leads yet. Submit the intake form on the offer page to seed the workspace.
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
                <h3 className="text-3xl font-semibold text-white">Priority Actions</h3>
                <div className="mt-5 space-y-3">
                  {snapshot.priorityActions.map((action) => (
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
                  {helixLawnPricingLogic.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-[26px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-5">
            <h3 className="text-3xl font-semibold text-white">Activity Stream</h3>
            <div className="mt-5 space-y-4">
              {snapshot.activityItems.map((item) => (
                <div key={`${item.meta}-${item.message}`} className="flex gap-4">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-[hsl(111_87%_65%)] shadow-[0_0_18px_hsl(111_87%_65%/.45)]" />
                  <div>
                    <div className="text-base text-white">{item.message}</div>
                    <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">{item.meta}</div>
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
