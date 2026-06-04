"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, useEffect, useState } from "react";

import {
  helixLawnPricingLogic,
  type HelixLawnCommandSnapshot,
} from "@/lib/helix-lawn-command";

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

type NavItem = (typeof navItems)[number];

const tabSlugs: Record<NavItem, string> = {
  Dashboard: "dashboard",
  "Lawn Leads": "lawn-leads",
  Pipeline: "pipeline",
  "Estimate Queue": "estimate-queue",
  "Follow-Ups": "follow-ups",
  "Outreach Drafts": "outreach-drafts",
  "Import History": "import-history",
  "Priority Actions": "priority-actions",
  Settings: "settings",
};

const tabsBySlug = Object.fromEntries(
  navItems.map((item) => [tabSlugs[item], item]),
) as Record<string, NavItem>;

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4 text-sm leading-6 text-[hsl(120_16%_72%)]">
      {message}
    </div>
  );
}

function PanelShell({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[24px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.84)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.34em] text-[hsl(111_87%_65%)]">{eyebrow}</p>
          <h3 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{title}</h3>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function HelixLawnCommandHome({
  snapshot,
  initialTab,
}: {
  snapshot: HelixLawnCommandSnapshot;
  initialTab?: string;
}) {
  const [activeTab, setActiveTab] = useState<NavItem>(
    initialTab && tabsBySlug[initialTab] ? tabsBySlug[initialTab] : "Dashboard",
  );

  useEffect(() => {
    function syncFromUrl() {
      const queryTab = new URLSearchParams(window.location.search).get("tab") ?? "";
      const slug = window.location.hash.replace("#", "");
      const nextTab = tabsBySlug[queryTab] ?? tabsBySlug[slug];
      if (nextTab) {
        setActiveTab(nextTab);
      }
    }

    syncFromUrl();
    window.addEventListener("hashchange", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  function activateTab(item: NavItem) {
    setActiveTab(item);
    const slug = tabSlugs[item];
    if (window.location.hash !== `#${slug}`) {
      window.history.replaceState(null, "", `#${slug}`);
    }
  }

  const headerCopy: Record<NavItem, string> = {
    Dashboard: "Live overview of the lawn command center.",
    "Lawn Leads": "Every captured lawn lead with contact, estimate, and stage details.",
    Pipeline: "Kanban-style stage view for quote flow and operator focus.",
    "Estimate Queue": "Manual-review jobs that need owner eyes before a quote goes out.",
    "Follow-Ups": "Leads that need a call, text, schedule option, or confirmation.",
    "Outreach Drafts": "Ready-to-send SMS drafts generated from lead details.",
    "Import History": "A clean activity trail of website intake events entering the system.",
    "Priority Actions": "The highest-leverage actions the operator should handle next.",
    Settings: "Operating rules, pricing references, and launch-readiness controls.",
  };

  return (
    <main
      style={{
        "--project-accent": "#63D11F",
        "--project-glow": "rgba(99,209,31,0.34)",
        "--project-surface": "rgba(99,209,31,0.12)",
        "--project-edge": "rgba(155,255,94,0.42)",
      } as CSSProperties}
      className="theme-lawn-command min-h-screen bg-[radial-gradient(circle_at_top,hsl(130_68%_9%/.9),transparent_36%),radial-gradient(circle_at_78%_10%,hsl(116_74%_28%/.10),transparent_28%),linear-gradient(180deg,hsl(148_44%_5%)_0%,hsl(150_40%_4%)_100%)] text-foreground"
    >
      <div className="mx-auto grid min-h-screen max-w-[1660px] gap-5 px-4 py-4 xl:grid-cols-[310px_minmax(0,1fr)] xl:px-6">
        <aside className="min-w-0 rounded-[28px] border border-[hsl(126_48%_22%/.45)] bg-[hsl(150_42%_7%/.92)] p-4 shadow-[0_24px_80px_hsl(0_0%_0%/.4)] sm:p-5 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <div className="grid gap-4 border-b border-[hsl(126_48%_22%/.35)] pb-5 sm:grid-cols-[120px_1fr] sm:items-center xl:grid-cols-1">
            <div className="max-w-[140px] overflow-hidden rounded-[18px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.9)] p-3 xl:max-w-none">
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
              <h1 className="mt-3 text-xl font-semibold text-white sm:text-2xl">Today at Blackspire</h1>
              <p className="mt-3 text-sm leading-6 text-[hsl(120_16%_72%)]">
                Live lawn leads are flowing from the Helix intake page into this workspace.
              </p>
            </div>
          </div>

          <nav className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-1" aria-label="Helix Lawn Command sections">
            {navItems.map((item) => {
              const active = activeTab === item;
              return (
                <Link
                  key={item}
                  href={`/workspace/helix-lawn-command?tab=${tabSlugs[item]}#${tabSlugs[item]}`}
                  onClick={() => activateTab(item)}
                  className={`block min-w-0 rounded-[16px] border px-3 py-3 text-left text-[11px] uppercase leading-5 tracking-[0.16em] transition sm:text-xs xl:px-4 ${
                    active
                      ? "border-[hsl(126_48%_28%/.75)] bg-[hsl(142_36%_11%/.95)] text-white shadow-[0_0_28px_hsl(111_87%_45%/.13)]"
                      : "border-[hsl(126_48%_18%/.4)] bg-[hsl(150_28%_8%/.75)] text-[hsl(120_16%_72%)] hover:border-[hsl(126_48%_28%/.58)] hover:text-white"
                  }`}
                  aria-pressed={active}
                >
                  {item}
                </Link>
              );
            })}
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

        <section className="min-w-0 space-y-5 rounded-[30px] border border-[hsl(126_48%_18%/.24)] bg-[hsl(150_42%_7%/.62)] p-4 shadow-[0_28px_90px_hsl(0_0%_0%/.34)] backdrop-blur-xl sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.44em] text-[hsl(111_87%_65%)]">Helix Lawn Command</p>
              <h2 className="mt-3 text-4xl font-semibold text-white sm:text-5xl">{activeTab}</h2>
              <p className="mt-3 text-base leading-7 text-[hsl(120_16%_72%)]">{headerCopy[activeTab]}</p>
            </div>
            <span className="rounded-full border border-[hsl(126_48%_28%/.55)] bg-[hsl(142_36%_10%/.88)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[hsl(111_87%_65%)]">
              Live
            </span>
          </header>

          {activeTab === "Dashboard" ? (
            <>
              <MetricGrid snapshot={snapshot} />
              <PipelinePanel snapshot={snapshot} compact />
              <div className="grid gap-5 2xl:grid-cols-[1.12fr_0.88fr]">
                <LeadsPanel snapshot={snapshot} compact />
                <PriorityPanel snapshot={snapshot} />
              </div>
              <ActivityPanel snapshot={snapshot} />
            </>
          ) : null}

          {activeTab === "Lawn Leads" ? <LeadsPanel snapshot={snapshot} /> : null}
          {activeTab === "Pipeline" ? <PipelinePanel snapshot={snapshot} /> : null}
          {activeTab === "Estimate Queue" ? <EstimateQueuePanel snapshot={snapshot} /> : null}
          {activeTab === "Follow-Ups" ? <FollowUpsPanel snapshot={snapshot} /> : null}
          {activeTab === "Outreach Drafts" ? <OutreachDraftsPanel snapshot={snapshot} /> : null}
          {activeTab === "Import History" ? <ImportHistoryPanel snapshot={snapshot} /> : null}
          {activeTab === "Priority Actions" ? <PriorityPanel snapshot={snapshot} expanded /> : null}
          {activeTab === "Settings" ? <SettingsPanel /> : null}
        </section>
      </div>
    </main>
  );
}

function MetricGrid({ snapshot }: { snapshot: HelixLawnCommandSnapshot }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {snapshot.metricCards.map((card) => (
        <article key={card.label} className="min-w-0 rounded-[22px] border border-[hsl(126_48%_22%/.35)] bg-[hsl(149_34%_9%/.88)] p-4 sm:p-5">
          <div className="text-3xl font-semibold text-white sm:text-4xl">{card.value}</div>
          <div className="mt-2 text-base font-medium text-[hsl(120_10%_86%)] sm:text-lg">{card.label}</div>
          <div className="mt-2 text-sm text-[hsl(111_68%_54%)]">{card.detail}</div>
        </article>
      ))}
    </section>
  );
}

function PipelinePanel({
  snapshot,
  compact = false,
}: {
  snapshot: HelixLawnCommandSnapshot;
  compact?: boolean;
}) {
  return (
    <PanelShell title="Lead Pipeline" eyebrow="Live stage view">
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-6">
        {snapshot.pipelineColumns.map((column) => (
          <div key={column.label} className="min-w-0 rounded-[20px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(150_28%_8%/.75)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase leading-5 tracking-[0.24em] text-[hsl(120_16%_72%)]">{column.label}</div>
              <div className="text-xs text-[hsl(111_87%_65%)]">{column.count}</div>
            </div>
            <div className="mt-3 space-y-3">
              {column.items.length ? (
                column.items.slice(0, compact ? 3 : undefined).map((lead) => (
                  <div key={lead.id} className="min-w-0 rounded-[14px] border border-[hsl(126_48%_18%/.25)] bg-[hsl(145_22%_11%/.92)] px-3 py-3">
                    <div className="text-sm font-medium text-white">{lead.name}</div>
                    <div className="mt-1 text-xs text-[hsl(120_16%_72%)]">{lead.service}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-[hsl(111_87%_65%)]">
                      <span>{lead.estimate}</span>
                      <span>{lead.urgency}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm italic text-[hsl(120_16%_52%)]">Empty</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function LeadsPanel({
  snapshot,
  compact = false,
}: {
  snapshot: HelixLawnCommandSnapshot;
  compact?: boolean;
}) {
  const leads = compact ? snapshot.recentLeads.slice(0, 4) : snapshot.recentLeads;

  return (
    <PanelShell title="Recent Lawn Leads" eyebrow={`${snapshot.totalLeadCount} total`}>
      <div className="space-y-3">
        {leads.length ? (
          leads.map((lead) => (
            <div key={lead.id} className="min-w-0 rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">
                    {lead.name} <span className="font-normal text-[hsl(120_16%_72%)]">· {lead.service}</span>
                  </div>
                  <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">{lead.address}</div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-[hsl(120_16%_52%)]">
                    {lead.stage} · {lead.confidence}
                  </div>
                  {!compact ? (
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-[hsl(120_16%_72%)]">{lead.summary}</p>
                  ) : null}
                </div>
                <div className="grid gap-2 text-right">
                  <span className="rounded-full border border-[hsl(126_48%_20%/.35)] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[hsl(111_87%_65%)]">
                    {lead.urgency}
                  </span>
                  <span className="text-lg font-semibold text-[hsl(111_87%_65%)]">{lead.estimate}</span>
                  {!compact ? <span className="text-xs text-[hsl(120_16%_72%)]">{lead.phone}</span> : null}
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No live leads yet. Submit the intake form on the offer page to seed the workspace." />
        )}
      </div>
    </PanelShell>
  );
}

function EstimateQueuePanel({ snapshot }: { snapshot: HelixLawnCommandSnapshot }) {
  return (
    <PanelShell title="Estimate Queue" eyebrow="Manual review">
      <div className="space-y-3">
        {snapshot.estimateQueue.length ? (
          snapshot.estimateQueue.map((lead) => (
            <div key={lead.id} className="min-w-0 rounded-[18px] border border-[hsl(53_72%_38%/.32)] bg-[hsl(53_42%_9%/.42)] px-4 py-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{lead.name}</div>
                  <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">{lead.service} · {lead.address}</div>
                  <p className="mt-3 text-sm leading-6 text-[hsl(120_16%_72%)]">{lead.reason}</p>
                </div>
                <span className="text-xl font-semibold text-[hsl(53_84%_64%)]">{lead.estimate}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No manual estimates are waiting right now. Heavy cleanup, acreage, and complex-access leads will appear here." />
        )}
      </div>
    </PanelShell>
  );
}

function FollowUpsPanel({ snapshot }: { snapshot: HelixLawnCommandSnapshot }) {
  return (
    <PanelShell title="Follow-Ups" eyebrow="Operator next steps">
      <div className="space-y-3">
        {snapshot.followUps.length ? (
          snapshot.followUps.map((lead) => (
            <div key={lead.id} className="min-w-0 rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{lead.name}</div>
                  <div className="mt-1 text-sm text-[hsl(120_16%_72%)]">{lead.phone} · {lead.service}</div>
                  <p className="mt-3 text-sm leading-6 text-[hsl(120_16%_72%)]">{lead.nextStep}</p>
                </div>
                <span className="text-lg font-semibold text-[hsl(111_87%_65%)]">{lead.estimate}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No follow-ups due. New, estimate-needed, and quote-sent leads will appear here." />
        )}
      </div>
    </PanelShell>
  );
}

function OutreachDraftsPanel({ snapshot }: { snapshot: HelixLawnCommandSnapshot }) {
  return (
    <PanelShell title="Outreach Drafts" eyebrow="Ready-to-send copy">
      <div className="grid gap-4 xl:grid-cols-2">
        {snapshot.outreachDrafts.length ? (
          snapshot.outreachDrafts.map((draft) => (
            <article key={draft.id} className="min-w-0 rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] p-4">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[hsl(111_87%_65%)]">{draft.channel}</div>
              <h4 className="mt-2 text-lg font-semibold text-white">{draft.subject}</h4>
              <p className="mt-3 text-sm leading-6 text-[hsl(120_16%_72%)]">{draft.body}</p>
            </article>
          ))
        ) : (
          <EmptyState message="No outreach drafts yet. Drafts are generated from live leads once they enter the system." />
        )}
      </div>
    </PanelShell>
  );
}

function ImportHistoryPanel({ snapshot }: { snapshot: HelixLawnCommandSnapshot }) {
  return (
    <PanelShell title="Import History" eyebrow="Website intake log">
      <div className="space-y-3">
        {snapshot.importHistory.length ? (
          snapshot.importHistory.map((item) => (
            <div key={item.id} className="min-w-0 rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">{item.source}</div>
                  <p className="mt-1 text-sm leading-6 text-[hsl(120_16%_72%)]">{item.detail}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-[0.22em] text-[hsl(111_87%_65%)]">{item.status}</div>
                  <div className="mt-1 text-xs text-[hsl(120_16%_72%)]">{new Date(item.createdAt).toLocaleString("en-US")}</div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No imports yet. Website intake submissions will be logged here." />
        )}
      </div>
    </PanelShell>
  );
}

function PriorityPanel({
  snapshot,
  expanded = false,
}: {
  snapshot: HelixLawnCommandSnapshot;
  expanded?: boolean;
}) {
  return (
    <PanelShell title="Priority Actions" eyebrow="What to do next">
      <div className={expanded ? "grid gap-3 xl:grid-cols-2" : "space-y-3"}>
        {snapshot.priorityActions.map((action) => (
          <div key={action} className="min-w-0 rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] px-4 py-4 text-sm leading-6 text-[hsl(120_16%_72%)]">
            {action}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function ActivityPanel({ snapshot }: { snapshot: HelixLawnCommandSnapshot }) {
  return (
    <PanelShell title="Activity Stream" eyebrow="Live operations">
      <div className="space-y-4">
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
    </PanelShell>
  );
}

function SettingsPanel() {
  return (
    <div className="grid gap-5 2xl:grid-cols-[0.92fr_1.08fr]">
      <PanelShell title="Realistic Pricing Logic" eyebrow="Owner reference">
        <div className="space-y-3 text-sm leading-7 text-[hsl(120_16%_72%)]">
          {helixLawnPricingLogic.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </PanelShell>

      <PanelShell title="Launch Controls" eyebrow="System status">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["Lead capture", "Online"],
            ["Supabase storage", "Connected"],
            ["Estimate logic", "Active"],
            ["Workspace tabs", "Functional"],
            ["SMS automation", "Next integration"],
            ["CRM routing", "Next integration"],
          ].map(([label, status]) => (
            <div key={label} className="rounded-[18px] border border-[hsl(126_48%_18%/.3)] bg-[hsl(145_22%_11%/.92)] p-4">
              <div className="text-[11px] uppercase tracking-[0.26em] text-[hsl(120_16%_72%)]">{label}</div>
              <div className="mt-2 text-lg font-semibold text-white">{status}</div>
            </div>
          ))}
        </div>
      </PanelShell>
    </div>
  );
}
