import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";
import { workspaceEntries } from "@/lib/site-structure";

export const metadata: Metadata = {
  title: "Workspace Directory | Blackspire Helix Group",
  description:
    "Move directly into the Blackspire Helix Group workspace directory for live operator surfaces across every division.",
};

const groupedWorkspaces = workspaceEntries.reduce<Record<string, typeof workspaceEntries>>((groups, entry) => {
  groups[entry.division] = [...(groups[entry.division] ?? []), entry];
  return groups;
}, {});

export default function WorkspacesDirectoryPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-[1450px] px-4 py-10 lg:px-6">
        <section className="brand-panel px-6 py-8 lg:px-8">
          <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Workspace Directory</p>
          <h1 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-6xl">
            Every operator surface, organized by division.
          </h1>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">
            Use this directory to move straight into the live command surfaces. Public division pages
            explain the ecosystem; these workspace routes are the operating layer where systems are
            run, checked, and extended.
          </p>
        </section>

        <div className="mt-6 grid gap-6">
          {Object.entries(groupedWorkspaces).map(([division, entries]) => (
            <section key={division} className="brand-panel px-6 py-8 lg:px-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">{division}</p>
                  <h2 className="brand-display mt-3 text-3xl text-white">{entries.length} workspace{entries.length === 1 ? "" : "s"}</h2>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {entries.map((entry) => (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    className="brand-card block p-5 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{entry.status}</span>
                      <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-soft)]">{entry.primaryAction}</span>
                    </div>
                    <div className="mt-4 text-xl font-semibold text-white">{entry.title}</div>
                    <p className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{entry.description}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </MarketingShell>
  );
}
