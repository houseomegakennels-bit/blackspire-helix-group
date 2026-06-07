"use client";

import { useCallback, useMemo, useState } from "react";

import { Panel, StatusPill } from "@/components/buyer-shell";
import type { BuyerGroupRegistryRow } from "@/lib/buyer-engine-server";

type ImportResult = {
  imported: number;
  total: number;
};

export function BuyerGroupsAdmin({
  initialRows,
}: {
  initialRows: BuyerGroupRegistryRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState("");
  const [csv, setCsv] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      `${row.canonicalName} ${row.aliases.join(" ")} ${row.counties.join(" ")} ${row.states.join(" ")} ${row.notes ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [filter, rows]);

  const activeCount = rows.filter((row) => row.active).length;

  const refresh = useCallback(async () => {
    const response = await fetch("/api/buyer-groups?admin=1", { cache: "no-store" });
    const payload = (await response.json()) as { ok: boolean; rows?: BuyerGroupRegistryRow[]; error?: string };
    if (!response.ok || !payload.ok || !payload.rows) {
      throw new Error(payload.error ?? "Buyer group registry refresh failed.");
    }
    setRows(payload.rows);
  }, []);

  const toggle = useCallback(async (row: BuyerGroupRegistryRow) => {
    if (row.id.startsWith("seed-")) {
      setError("Seed fallback rows cannot be toggled. Apply migration 004_buyer_group_registry.sql to manage live registry rows.");
      return;
    }

    setSavingId(row.id);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/buyer-groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, active: !row.active }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Buyer group toggle failed.");
      }
      await refresh();
      setStatus(`${row.canonicalName} ${row.active ? "deactivated" : "activated"}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Buyer group toggle failed.");
    } finally {
      setSavingId(null);
    }
  }, [refresh]);

  const importCsv = useCallback(async () => {
    if (!csv.trim()) {
      setError("Paste CSV rows before importing.");
      return;
    }

    setImporting(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/buyer-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const payload = (await response.json()) as { ok: boolean; result?: ImportResult; error?: string };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Buyer group import failed.");
      }
      await refresh();
      setCsv("");
      setStatus(`Imported ${payload.result.imported} buyer group rows.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Buyer group import failed.");
    } finally {
      setImporting(false);
    }
  }, [csv, refresh]);

  return (
    <>
      <Panel
        eyebrow="Buyer Groups"
        title="Institutional buyer registry"
        description="Manage hedge fund group aliases separately from county sale parsing. Buyer search still discovers activity from county data; this registry adds identity enrichment and filtering. If the live registry table exists but is empty, Buyer Engine now auto-seeds the default institutional groups on first read."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Registry rows</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{rows.length}</div>
          </div>
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Active groups</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{activeCount}</div>
            <div className="brand-copy-soft mt-1 text-xs">Used for live buyer matching</div>
          </div>
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Fallback mode</div>
            <div className="mt-2">
              <StatusPill
                tone={rows.some((row) => row.id.startsWith("seed-")) ? "warn" : "good"}
                label={rows.some((row) => row.id.startsWith("seed-")) ? "seeded fallback" : "database-backed"}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="brand-card p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.28em] text-[var(--gold-soft)]">CSV import</div>
            <p className="brand-copy-soft mb-3 text-sm leading-6">
              Expected columns: `canonical_name`, `aliases`, optional `states`, `counties`, `website`, `notes`, `active`.
              Multi-value fields can use `|`, `;`, or `,`.
            </p>
            <textarea
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={"canonical_name,aliases,states,counties,website,notes,active\nInvitation Homes,\"Invitation Homes|IH2 Property\",NC,\"Mecklenburg|Wake\",https://www.invitationhomes.com,Core SFR buyer,true"}
              className="brand-input min-h-56 w-full px-3 py-3 text-sm outline-none"
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void importCsv()}
                disabled={importing}
                className="brand-button px-4 py-2 text-sm disabled:opacity-60"
              >
                {importing ? "Importing..." : "Import CSV"}
              </button>
              {status ? <span className="text-sm text-[hsl(40_100%_72%)]">{status}</span> : null}
              {error ? <span className="text-sm text-[hsl(16_100%_66%)]">{error}</span> : null}
            </div>
          </div>

          <div className="brand-card p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.28em] text-[var(--gold-soft)]">Registry filter</div>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by group, alias, county, state, or notes"
              className="brand-input w-full px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>
      </Panel>

      <Panel
        eyebrow="Registry Rows"
        title="Buyer group aliases"
        description="These aliases are what the Buyer Reports matcher uses when it tags institutional or hedge-fund buyers."
      >
        <div className="brand-table-shell">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="brand-table-head">
              <tr>
                <th className="px-4 py-3 font-medium">Group</th>
                <th className="px-4 py-3 font-medium">Aliases</th>
                <th className="px-4 py-3 font-medium">Markets</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? filteredRows.map((row) => (
                <tr key={row.id} className="brand-table-row">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{row.canonicalName}</div>
                    <div className="brand-copy-muted mt-1 text-xs">{row.website ?? row.notes ?? row.groupType}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="brand-copy-soft text-xs leading-5">{row.aliases.join(", ")}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="brand-copy-soft text-xs leading-5">
                      {[...row.states, ...row.counties].length ? [...row.states, ...row.counties].join(", ") : "Unspecified"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      tone={row.id.startsWith("seed-") ? "warn" : row.active ? "good" : "bad"}
                      label={row.id.startsWith("seed-") ? "seeded" : row.active ? "active" : "inactive"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void toggle(row)}
                      disabled={savingId === row.id || row.id.startsWith("seed-")}
                      className="brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                    >
                      {savingId === row.id ? "Saving..." : row.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              )) : (
                <tr className="brand-table-row">
                  <td colSpan={5} className="px-4 py-6 text-center brand-copy-soft">
                    No buyer groups match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
