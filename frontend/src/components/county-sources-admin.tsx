"use client";

import { useCallback, useState } from "react";
import { Panel, StatusPill } from "@/components/buyer-shell";
import type { AdminCountySourceRow } from "@/lib/buyer-engine-server";

type ToggleState = { id: string; saving: boolean; error: string | null };

export function CountySourcesAdmin({
  initialRows,
}: {
  initialRows: AdminCountySourceRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [toggleStates, setToggleStates] = useState<Record<string, ToggleState>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  const filteredRows = filter.trim()
    ? rows.filter((r) =>
        `${r.county} ${r.state} ${r.source_type} ${r.notes ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
      )
    : rows;

  const toggle = useCallback(async (row: AdminCountySourceRow) => {
    const newActive = !row.active;
    setToggleStates((prev) => ({
      ...prev,
      [row.id]: { id: row.id, saving: true, error: null },
    }));
    setGlobalError(null);

    try {
      const res = await fetch("/api/county-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, active: newActive }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Toggle failed.");
      }
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, active: newActive } : r)),
      );
      setToggleStates((prev) => ({ ...prev, [row.id]: { id: row.id, saving: false, error: null } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Toggle failed.";
      setToggleStates((prev) => ({ ...prev, [row.id]: { id: row.id, saving: false, error: msg } }));
      setGlobalError(msg);
    }
  }, []);

  return (
    <>
      <Panel
        eyebrow="County Sources"
        title="CountyDataSource registry"
        description="Each row is a live ArcGIS or OpenGov source registered in Supabase. Toggle active/inactive to include or exclude a county from buyer sweeps — the workflow only runs against active sources."
      >
        <div className="grid gap-3 md:grid-cols-3 mb-4">
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Total rows</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{rows.length}</div>
          </div>
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Active</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{activeCount}</div>
            <div className="brand-copy-soft mt-1 text-xs">Included in buyer sweeps</div>
          </div>
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Inactive</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{inactiveCount}</div>
            <div className="brand-copy-soft mt-1 text-xs">Excluded from sweeps</div>
          </div>
        </div>

        <div className="mb-4">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by county, source type, or notes…"
            className="brand-input w-full px-3 py-2 text-sm outline-none"
          />
        </div>

        {globalError ? (
          <div className="mb-4 rounded-lg border border-[hsl(16_100%_50%/.3)] bg-[hsl(16_100%_44%/.08)] px-4 py-3 text-sm text-[hsl(22_100%_72%)]">
            {globalError}
          </div>
        ) : null}

        <div className="brand-table-shell">
          <table className="w-full min-w-[740px] border-collapse text-left text-sm">
            <thead className="brand-table-head">
              <tr>
                <th className="px-4 py-3 font-medium">County / State</th>
                <th className="px-4 py-3 font-medium">Source Type</th>
                <th className="px-4 py-3 font-medium">Source URL</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? filteredRows.map((row) => {
                const ts = toggleStates[row.id];
                return (
                  <tr key={row.id} className="brand-table-row">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{row.county}</div>
                      <div className="brand-copy-muted mt-0.5 text-xs">{row.state}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-[var(--copy-soft)]">{row.source_type}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[240px]">
                      {row.source_url ? (
                        <a
                          href={row.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-[var(--gold-soft)] underline-offset-4 hover:underline break-all"
                        >
                          {row.source_url.length > 60
                            ? `${row.source_url.slice(0, 60)}…`
                            : row.source_url}
                        </a>
                      ) : (
                        <span className="brand-copy-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <span className="brand-copy-soft text-xs leading-5">{row.notes ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        tone={row.active ? "good" : "bad"}
                        label={row.active ? "active" : "inactive"}
                      />
                      {ts?.error ? (
                        <div className="mt-1 text-[10px] text-[hsl(22_100%_72%)]">{ts.error}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={ts?.saving}
                        onClick={() => void toggle(row)}
                        className={`brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50 ${
                          row.active
                            ? "border-[hsl(16_100%_50%/.4)] text-[hsl(22_100%_72%)] hover:bg-[hsl(16_100%_44%/.1)]"
                            : ""
                        }`}
                      >
                        {ts?.saving ? "Saving…" : row.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr className="brand-table-row">
                  <td colSpan={6} className="px-4 py-6 text-center brand-copy-soft">
                    No county sources match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-[var(--copy-muted)] leading-5">
          Changes take effect immediately in Supabase. County capabilities are cached for ~60 seconds — the workflow will pick up the new state on its next run.
        </p>
      </Panel>
    </>
  );
}
