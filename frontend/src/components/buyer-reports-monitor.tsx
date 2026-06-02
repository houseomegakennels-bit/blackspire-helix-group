"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel, StatusPill } from "@/components/buyer-shell";
import {
  getCountyCapability,
  getCountyOperationalRisk,
  getCountyVerificationTone,
  type CountyCapability,
} from "@/lib/buyer-engine-data";
import {
  loadOutreachDraftsWithFallback,
  persistOutreachDraftWithFallback,
  type OutreachDraftStoreStatus,
  type OutreachDraftRecord,
} from "@/lib/outreach-drafts";
import {
  buildRealtimeChannelName,
  getBuyerEngineBrowserClient,
  removeRealtimeChannel,
} from "@/lib/buyer-engine-browser";
import type { OperatorShellStatus } from "@/lib/buyer-engine-server";

type BuyerReportsEnv = {
  enabled: boolean;
  missing: string[];
  hasDefaultUserId: boolean;
};

type RealtimeClientEnv = {
  enabled: boolean;
  url: string | null;
  anonKey: string | null;
};

type BuyerReportView = {
  id: string;
  searchJobId: string;
  county: string | null;
  state: string | null;
  propertyType: string | null;
  buyerName: string;
  mailingAddress: string;
  score: number;
  purchaseCount: number;
  totalSpend: number;
  isLlc: boolean;
  isCashBuyer: boolean;
  buyerIdentityNote: string | null;
  createdAt: string;
};

type ApiBuyerReport = {
  id: string;
  search_job_id: string | null;
  search_job?: {
    county: string;
    state: string;
    property_type: string;
    status: "pending" | "processing" | "completed" | "failed";
  } | null;
  buyer_name_snapshot: string | null;
  BuyerProfile?: BuyerProfileApi | BuyerProfileApi[] | null;
  mailing_address_snapshot: string | null;
  score: number | null;
  purchase_count: number | null;
  total_spend: number | null;
  is_llc: boolean | null;
  is_cash_buyer: boolean | null;
  created_at: string;
};

type BuyerReportsPayload = {
  ok: boolean;
  reports: ApiBuyerReport[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  env: BuyerReportsEnv;
  error?: string;
};

type ApiExportRecord = {
  id: string;
  file_name: string;
  storage_path: string;
  row_count: number | null;
  created_at: string;
  search_job_id: string | null;
};

type ExportPayload = {
  ok: boolean;
  exports?: ApiExportRecord[];
  export?: ApiExportRecord;
  error?: string;
};

type OutreachPayload = {
  ok: boolean;
  draft?: {
    subject: string;
    angle: string;
    body: string;
  };
  error?: string;
};

type SummaryPayload = {
  ok: boolean;
  aiGenerated?: boolean;
  summary?: string;
  error?: string;
};

type AiSummaryState = {
  loading: boolean;
  text: string | null;
  aiGenerated: boolean;
  error: string | null;
};

export function BuyerReportsMonitor({
  initialReports,
  initialTotalCount,
  initialPageSize,
  initialEnv,
  realtime,
  searchJobId,
  countyCapabilities,
  operatorStatus,
}: {
  initialReports: BuyerReportView[];
  initialTotalCount: number;
  initialPageSize: number;
  initialEnv: BuyerReportsEnv;
  realtime: RealtimeClientEnv;
  searchJobId?: string;
  countyCapabilities: CountyCapability[];
  operatorStatus?: OperatorShellStatus | null;
}) {
  const [reports, setReports] = useState(initialReports);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [env, setEnv] = useState(initialEnv);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(new Date());
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [savingExport, setSavingExport] = useState(false);
  const [recentExports, setRecentExports] = useState<ApiExportRecord[]>([]);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<OutreachDraftRecord[]>([]);
  const [draftStoreStatus, setDraftStoreStatus] = useState<OutreachDraftStoreStatus>({
    storage: "browser",
    supported: false,
  });
  const [realtimeStatus, setRealtimeStatus] = useState<"idle" | "connected" | "fallback">(
    realtime.enabled ? "idle" : "fallback",
  );
  const [aiSummaries, setAiSummaries] = useState<Record<string, AiSummaryState>>({});

  const liveMode = env.enabled;
  const writeBlocked = Boolean(operatorStatus?.requiresAuth || operatorStatus?.bootstrapRequired);
  const writeBlockMessage = operatorStatus?.requiresAuth
    ? "Sign in through /auth before exporting buyer cohorts or saving outreach drafts."
    : operatorStatus?.bootstrapRequired
      ? "Bootstrap the first operator in /auth before using buyer dossier actions in normal mode."
      : null;
  const countyCapabilityMap = useMemo(
    () =>
      Object.fromEntries(
        countyCapabilities.map((county) => [county.county.trim().toLowerCase(), county]),
      ) as Record<string, CountyCapability>,
    [countyCapabilities],
  );

  const refreshReports = useCallback(async () => {
    if (!liveMode) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(Math.max(reports.length, initialPageSize)));
      params.set("offset", "0");
      if (searchJobId) params.set("searchJobId", searchJobId);

      const response = await fetch(`/api/buyer-reports?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as BuyerReportsPayload;

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Buyer report refresh failed.");
        if (payload.env) setEnv(payload.env);
        return;
      }

      setReports(payload.reports.map(mapApiReportToView));
      setTotalCount(payload.total);
      setEnv(payload.env);
      setLastCheckedAt(new Date());
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Buyer report refresh failed.");
    } finally {
      setLoading(false);
    }
  }, [initialPageSize, liveMode, reports.length, searchJobId]);

  useEffect(() => {
    if (!liveMode) return;

    const interval = window.setInterval(() => {
      void refreshReports();
    }, realtimeStatus === "connected" ? 30000 : 7000);

    return () => window.clearInterval(interval);
  }, [liveMode, realtimeStatus, refreshReports]);

  const refreshExports = useCallback(async () => {
    if (!liveMode) return;

    try {
      const queryString = searchJobId ? `?searchJobId=${encodeURIComponent(searchJobId)}` : "";
      const response = await fetch(`/api/exports${queryString}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as ExportPayload;

      if (!response.ok || !payload.ok) {
        return;
      }

      setRecentExports(payload.exports ?? []);
    } catch {
      // Export history is additive UI; keep failures non-blocking.
    }
  }, [liveMode, searchJobId]);

  useEffect(() => {
    void refreshExports();
  }, [refreshExports]);

  useEffect(() => {
    if (!liveMode || !realtime.enabled || !realtime.url || !realtime.anonKey) {
      setRealtimeStatus("fallback");
      return;
    }

    const supabase = getBuyerEngineBrowserClient({
      url: realtime.url,
      anonKey: realtime.anonKey,
    });
    if (!supabase) {
      setRealtimeStatus("fallback");
      return;
    }

    const channel = supabase.channel(buildRealtimeChannelName("buyer-reports"));
    channel
      .on(
        "postgres_changes",
        searchJobId
          ? {
              event: "*",
              schema: "public",
              table: "BuyerReport",
              filter: `search_job_id=eq.${searchJobId}`,
            }
          : { event: "*", schema: "public", table: "BuyerReport" },
        () => {
          setRealtimeStatus("connected");
          void refreshReports();
        },
      )
      .on(
        "postgres_changes",
        searchJobId
          ? {
              event: "*",
              schema: "public",
              table: "exports",
              filter: `search_job_id=eq.${searchJobId}`,
            }
          : { event: "*", schema: "public", table: "exports" },
        () => {
          setRealtimeStatus("connected");
          void refreshExports();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus("fallback");
        }
      });

    return () => {
      removeRealtimeChannel(supabase, channel);
    };
  }, [
    liveMode,
    realtime.enabled,
    realtime.url,
    realtime.anonKey,
    refreshExports,
    refreshReports,
    searchJobId,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadOutreachDraftsWithFallback(searchJobId).then((result) => {
      if (cancelled) return;
      setSavedDrafts(result.drafts);
      setDraftStoreStatus(result.status);
    });
    return () => {
      cancelled = true;
    };
  }, [searchJobId]);

  const filteredReports = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return reports;

    return reports.filter((report) =>
      `${report.buyerName} ${report.mailingAddress} ${report.searchJobId}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, reports]);

  const summary = useMemo(() => {
    const totalVisibleSpend = filteredReports.reduce((sum, report) => sum + report.totalSpend, 0);
    const highScoreCount = filteredReports.filter((report) => report.score >= 60).length;
    const llcCount = filteredReports.filter((report) => report.isLlc).length;

    return {
      totalVisibleSpend,
      highScoreCount,
      llcCount,
    };
  }, [filteredReports]);

  const hasMoreReports = reports.length < totalCount;

  const loadMoreReports = useCallback(async () => {
    if (!liveMode || loadingMore || !hasMoreReports) return;

    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(initialPageSize));
      params.set("offset", String(reports.length));
      if (searchJobId) params.set("searchJobId", searchJobId);

      const response = await fetch(`/api/buyer-reports?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as BuyerReportsPayload;

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "More buyer reports could not be loaded.");
        if (payload.env) setEnv(payload.env);
        return;
      }

      setReports((current) => [
        ...current,
        ...payload.reports
          .map(mapApiReportToView)
          .filter((candidate) => !current.some((existing) => existing.id === candidate.id)),
      ]);
      setTotalCount(payload.total);
      setEnv(payload.env);
      setLastCheckedAt(new Date());
      setError(null);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "More buyer reports could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [hasMoreReports, initialPageSize, liveMode, loadingMore, reports.length, searchJobId]);

  const exportCsv = useCallback(async () => {
    const rows = filteredReports.map((report) => ({
      buyer_name: report.buyerName,
      mailing_address: report.mailingAddress,
      county: report.county ?? "",
      state: report.state ?? "",
      property_type: report.propertyType ?? "",
      score: report.score,
      purchase_count: report.purchaseCount,
      total_spend: report.totalSpend,
      is_llc: report.isLlc ? "yes" : "no",
      is_cash_buyer: report.isCashBuyer ? "yes" : "no",
      search_job_id: report.searchJobId,
      created_at: report.createdAt,
    }));

    if (!rows.length) return;

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => escapeCsvValue(String(row[header as keyof typeof row] ?? "")))
          .join(","),
      ),
    ].join("\n");

    const fileName = searchJobId
      ? `buyer-reports-${searchJobId}.csv`
      : `buyer-reports-${new Date().toISOString().slice(0, 10)}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    if (!liveMode) {
      setExportStatus("CSV downloaded locally.");
      return;
    }

    setSavingExport(true);
    setExportStatus(null);
    try {
      const response = await fetch("/api/exports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          searchJobId,
          fileName,
          rowCount: rows.length,
        }),
      });
      const payload = (await response.json()) as ExportPayload;

      if (!response.ok || !payload.ok || !payload.export) {
        throw new Error(payload.error ?? "Export record could not be saved.");
      }

      setRecentExports((current) => [payload.export!, ...current].slice(0, 12));
      setExportStatus(`Export saved as ${payload.export.file_name}.`);
    } catch (exportError) {
      setExportStatus(
        exportError instanceof Error
          ? `CSV downloaded, but export log failed: ${exportError.message}`
          : "CSV downloaded, but export log failed.",
      );
    } finally {
      setSavingExport(false);
    }
  }, [filteredReports, liveMode, searchJobId]);

  const copyOutreachBrief = useCallback(async (report: BuyerReportView) => {
    const countyRisk =
      report.county && report.propertyType
        ? getCountyOperationalRisk(report.county, report.propertyType)
        : null;
    const lines = [
      `Buyer: ${report.buyerName}`,
      `Mailing address: ${report.mailingAddress}`,
      report.county && report.state ? `Market: ${report.county}, ${report.state}` : null,
      report.propertyType ? `Property type: ${report.propertyType.replace("_", " ")}` : null,
      `Score: ${report.score}`,
      `Purchase count: ${report.purchaseCount}`,
      `Visible spend: ${formatMoney(report.totalSpend)}`,
      `Entity type: ${report.isLlc ? "LLC / entity" : "individual"}`,
      `Cash signal: ${report.isCashBuyer ? "cash buyer" : "not flagged"}`,
      countyRisk ? `County risk: ${countyRisk.label} - ${countyRisk.message}` : null,
      `Search job: ${report.searchJobId}`,
      "",
      "Suggested outreach angle:",
      report.isLlc
        ? "Reference repeat acquisition activity and ask whether the team is still buying land in this county."
        : "Reference recent land acquisition activity and ask whether they are still actively buying in this county.",
    ].filter(Boolean);

    await navigator.clipboard.writeText(lines.join("\n"));
    setCopiedReportId(report.id);
    window.setTimeout(() => {
      setCopiedReportId((current) => (current === report.id ? null : current));
    }, 2000);
  }, []);

  const saveOutreachDraft = useCallback(async (report: BuyerReportView) => {
    setSavingDraftId(report.id);
    setDraftStatus(null);

    try {
      const response = await fetch("/api/outreach-brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          searchJobId: report.searchJobId,
          buyerName: report.buyerName,
          mailingAddress: report.mailingAddress,
          county: report.county,
          state: report.state,
          propertyType: report.propertyType,
          score: report.score,
          purchaseCount: report.purchaseCount,
          totalSpend: report.totalSpend,
          isLlc: report.isLlc,
          isCashBuyer: report.isCashBuyer,
        }),
      });
      const payload = (await response.json()) as OutreachPayload;

      if (!response.ok || !payload.ok || !payload.draft) {
        throw new Error(payload.error ?? "Outreach draft generation failed.");
      }

      const record: OutreachDraftRecord = {
        id: `${report.id}-${Date.now()}`,
        source: "buyers",
        searchJobId: report.searchJobId,
        buyerName: report.buyerName,
        mailingAddress: report.mailingAddress,
        county: report.county,
        state: report.state,
        propertyType: report.propertyType,
        score: report.score,
        purchaseCount: report.purchaseCount,
        totalSpend: report.totalSpend,
        isLlc: report.isLlc,
        isCashBuyer: report.isCashBuyer,
        subject: payload.draft.subject,
        angle: payload.draft.angle,
        body: payload.draft.body,
        createdAt: new Date().toISOString(),
      };

      const persistence = await persistOutreachDraftWithFallback(record);
      setDraftStoreStatus(persistence.status);
      setSavedDrafts(
        (searchJobId
          ? persistence.drafts.filter((draft) => draft.searchJobId === searchJobId)
          : persistence.drafts).slice(0, 12),
      );
      await navigator.clipboard.writeText(payload.draft.body);
      setDraftStatus(`Draft saved for ${report.buyerName} and copied to clipboard.`);
    } catch (draftError) {
      setDraftStatus(
        draftError instanceof Error ? draftError.message : "Outreach draft generation failed.",
      );
    } finally {
      setSavingDraftId(null);
    }
  }, [searchJobId]);

  const copySavedDraft = useCallback(async (draft: OutreachDraftRecord) => {
    await navigator.clipboard.writeText(draft.body);
    setDraftStatus(`Saved draft copied for ${draft.buyerName}.`);
  }, []);

  const fetchAiSummary = useCallback(async (report: BuyerReportView) => {
    setAiSummaries((prev) => ({
      ...prev,
      [report.id]: { loading: true, text: null, aiGenerated: false, error: null },
    }));

    try {
      const response = await fetch("/api/buyer-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerName: report.buyerName,
          mailingAddress: report.mailingAddress,
          county: report.county,
          state: report.state,
          propertyType: report.propertyType,
          score: report.score,
          purchaseCount: report.purchaseCount,
          totalSpend: report.totalSpend,
          isLlc: report.isLlc,
          isCashBuyer: report.isCashBuyer,
          searchJobId: report.searchJobId,
        }),
      });
      const payload = (await response.json()) as SummaryPayload;

      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error ?? "Summary generation failed.");
      }

      setAiSummaries((prev) => ({
        ...prev,
        [report.id]: {
          loading: false,
          text: payload.summary!,
          aiGenerated: Boolean(payload.aiGenerated),
          error: null,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Summary generation failed.";
      setAiSummaries((prev) => ({
        ...prev,
        [report.id]: { loading: false, text: null, aiGenerated: false, error: msg },
      }));
    }
  }, []);

  return (
    <>
      <Panel
        eyebrow="Buyer Reports"
        title={liveMode ? "Live buyer report feed" : "Sample buyer report feed"}
        description={
          liveMode
            ? "This view polls the BuyerReport table so completed searches immediately become usable outreach targets."
            : `The repo is still missing env values: ${env.missing.join(", ")}`
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">High score buyers</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{summary.highScoreCount}</div>
            <div className="brand-copy-soft mt-1 text-xs">Visible buyers with score 60+</div>
          </div>
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Visible spend</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{formatMoney(summary.totalVisibleSpend)}</div>
            <div className="brand-copy-soft mt-1 text-xs">Current filtered report set</div>
          </div>
          <div className="brand-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">LLC buyers</div>
            <div className="mt-2 text-2xl font-semibold text-white tabular-nums">{summary.llcCount}</div>
            <div className="brand-copy-soft mt-1 text-xs">Investor entities in visible results</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusPill tone={liveMode ? "active" : "warn"} label={liveMode ? "live mode" : "fallback mode"} />
          <StatusPill tone={env.hasDefaultUserId ? "good" : "neutral"} label={env.hasDefaultUserId ? "default user configured" : "no default user id"} />
          {searchJobId ? <StatusPill tone="warn" label="single job focus" /> : null}
          <StatusPill
            tone={realtimeStatus === "connected" ? "good" : realtimeStatus === "idle" ? "neutral" : "warn"}
            label={
              realtimeStatus === "connected"
                ? "realtime on"
                : realtimeStatus === "idle"
                  ? "realtime starting"
                  : "polling fallback"
            }
          />
          <StatusPill
            tone={hasMoreReports ? "warn" : "good"}
            label={`loaded ${reports.length} of ${totalCount}`}
          />
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={!filteredReports.length || savingExport || writeBlocked}
            className="brand-button px-3 py-2 text-sm disabled:opacity-60"
          >
            {savingExport ? "Saving export..." : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => void refreshReports()}
            disabled={!liveMode || loading}
            className="brand-button px-3 py-2 text-sm disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh now"}
          </button>
          <span className="brand-copy-soft text-sm">Last checked: {lastCheckedAt ? lastCheckedAt.toLocaleTimeString() : "not yet"}</span>
          {error ? <span className="text-sm text-rose-300">{error}</span> : null}
          {exportStatus ? <span className="text-sm text-emerald-300">{exportStatus}</span> : null}
          {draftStatus ? <span className="text-sm text-sky-300">{draftStatus}</span> : null}
          {writeBlockMessage ? <span className="text-sm text-[hsl(22_100%_72%)]">{writeBlockMessage}</span> : null}
        </div>

        <div className="mt-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              searchJobId
                ? "Filter this dossier by buyer or mailing address"
                : "Filter by buyer, mailing address, or search job id"
            }
            className="brand-input w-full px-3 py-2 text-sm outline-none"
          />
        </div>
      </Panel>

      <Panel
        eyebrow="Export Ledger"
        title={searchJobId ? "Recent exports for this job" : "Recent buyer report exports"}
        description="Every CSV action now writes an exports record to Supabase so operators have a recoverable trail instead of clipboard-only work."
      >
        <div className="brand-table-shell">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="brand-table-head">
              <tr>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">Storage Path</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentExports.length ? (
                recentExports.map((record) => (
                  <tr key={record.id} className="brand-table-row">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{record.file_name}</div>
                      <div className="brand-copy-muted mt-1 font-mono text-[11px]">{record.id}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{record.row_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="brand-copy-soft font-mono text-[11px]">{record.storage_path}</div>
                    </td>
                    <td className="brand-copy-soft px-4 py-3">{new Date(record.created_at).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr className="brand-table-row">
                  <td colSpan={4} className="px-4 py-6">
                    No export records yet. The first CSV download will create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        eyebrow="Outreach Drafts"
        title={searchJobId ? "Saved drafts for this job" : "Saved outreach drafts"}
        description={
          draftStoreStatus.supported
            ? "Draft generation is live and drafts are being recovered from server storage."
            : "Draft generation is live. If server storage is unavailable, the app falls back to browser-local draft storage."
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusPill
            tone={draftStoreStatus.supported ? "good" : "warn"}
            label={draftStoreStatus.supported ? "server draft storage" : "browser draft fallback"}
          />
        </div>
        <div className="space-y-3">
          {savedDrafts.length ? (
            savedDrafts.map((draft) => (
              <div key={draft.id} className="brand-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">{draft.buyerName}</div>
                    <div className="brand-copy-muted mt-1 text-xs">{draft.subject}</div>
                    <div className="brand-copy-muted mt-1 text-xs">{new Date(draft.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/searches?highlight=${encodeURIComponent(draft.searchJobId)}`}
                      className="brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition"
                    >
                      Open job
                    </Link>
                    <button
                      type="button"
                      onClick={() => void copySavedDraft(draft)}
                      className="brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition"
                    >
                      Copy saved draft
                    </button>
                  </div>
                </div>
                <p className="brand-copy-soft mt-3 whitespace-pre-line text-sm leading-6">{draft.body}</p>
              </div>
            ))
          ) : (
            <div className="brand-card brand-copy-soft p-4 text-sm">
              No saved outreach drafts yet. Use "Save draft" on a buyer row to build the first one.
            </div>
          )}
        </div>
      </Panel>

      <Panel
        eyebrow="Dossiers"
        title="Live buyer report ledger"
        description="This is the actual ranked output surface that the workflow is building toward. Completed runs should become searchable here without leaving the app."
      >
        {hasMoreReports ? (
          <div className="brand-surface brand-copy-soft border-x-0 border-t-0 px-4 py-3 text-sm">
            Showing the first {reports.length} of {totalCount} buyer reports. Load more to expand the dossier without slowing the first render.
          </div>
        ) : null}
        <div className="brand-table-shell">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="brand-table-head">
              <tr>
                <th className="px-4 py-3 font-medium">Buyer</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Purchases</th>
                <th className="px-4 py-3 font-medium">Spend</th>
                <th className="px-4 py-3 font-medium">Search Job</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => {
                const aiSummary = aiSummaries[report.id];
                return (
                <tr key={report.id} className="brand-table-row">
                  <td className="px-4 py-3">
                      {(() => {
                      const capability =
                        report.county
                          ? countyCapabilityMap[report.county.trim().toLowerCase()] ??
                            getCountyCapability(report.county, countyCapabilities)
                          : null;
                      return (
                        <>
                    <div className="font-medium text-white">{report.buyerName}</div>
                    <div className="brand-copy-muted mt-1 text-xs">{report.mailingAddress}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {report.county && report.propertyType ? (
                        <StatusPill
                          tone={getCountyOperationalRisk(report.county, report.propertyType).tone}
                          label={getCountyOperationalRisk(report.county, report.propertyType).label}
                        />
                      ) : null}
                      {capability ? (
                        <StatusPill
                          tone={getCountyVerificationTone(capability.verificationStatus)}
                          label={
                            capability.verificationStatus === "approved"
                              ? "90-day ready"
                              : capability.verificationStatus.replace(/_/g, " ")
                          }
                        />
                      ) : null}
                      {report.isLlc ? <StatusPill tone="good" label="llc" /> : null}
                      {report.isCashBuyer ? <StatusPill tone="warn" label="cash" /> : null}
                      {report.buyerIdentityNote ? <StatusPill tone="warn" label="identity medium" /> : null}
                    </div>
                    {report.county && report.state && report.propertyType ? (
                      <div className="brand-copy-muted mt-2 text-xs">
                        {report.state} / {report.county} / {report.propertyType.replace("_", " ")}
                      </div>
                    ) : null}
                    {capability ? (
                      <div className="brand-copy-muted mt-2 text-xs">{capability.verificationReason}</div>
                    ) : null}
                    {report.buyerIdentityNote ? (
                      <div className="mt-2 border-l border-[hsl(33_100%_50%/.42)] pl-3 text-xs leading-5 text-[hsl(38_100%_76%)]">
                        {report.buyerIdentityNote}
                      </div>
                    ) : null}
                    {aiSummary?.text ? (
                      <div className="mt-3 rounded-[8px] border border-[var(--line)] bg-[hsl(33_100%_50%/.06)] px-3 py-2">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--gold-soft)]">
                            {aiSummary.aiGenerated ? "AI Summary" : "Oracle Summary"}
                          </span>
                        </div>
                        <p className="text-xs leading-5 text-[var(--copy-soft)]">{aiSummary.text}</p>
                      </div>
                    ) : null}
                    {aiSummary?.error ? (
                      <div className="mt-2 text-[10px] text-[hsl(22_100%_72%)]">{aiSummary.error}</div>
                    ) : null}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      tone={report.score >= 60 ? "active" : report.score >= 40 ? "warn" : "neutral"}
                      label={`score ${report.score}`}
                    />
                  </td>
                  <td className="px-4 py-3 tabular-nums">{report.purchaseCount}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(report.totalSpend)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/searches?highlight=${encodeURIComponent(report.searchJobId)}`}
                      className="brand-copy-soft font-mono text-xs underline-offset-4 hover:text-white hover:underline"
                    >
                      {report.searchJobId}
                    </Link>
                    <div className="brand-copy-muted mt-1 text-xs">{new Date(report.createdAt).toLocaleString()}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyOutreachBrief(report)}
                        className="brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition"
                      >
                        {copiedReportId === report.id ? "Copied" : "Copy outreach"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveOutreachDraft(report)}
                        disabled={savingDraftId === report.id || writeBlocked}
                        className="brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-60"
                      >
                        {savingDraftId === report.id ? "Saving..." : "Save draft"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void fetchAiSummary(report)}
                        disabled={aiSummary?.loading}
                        className="brand-button px-3 py-2 text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-60"
                      >
                        {aiSummary?.loading ? "Analyzing..." : aiSummary?.text ? "Re-analyze" : "AI Summary"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasMoreReports ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMoreReports()}
              disabled={loadingMore}
              className="brand-button px-4 py-2 text-sm transition disabled:opacity-60"
            >
              {loadingMore
                ? "Loading more..."
                : `Load ${Math.min(initialPageSize, totalCount - reports.length)} more buyer reports`}
            </button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}

function mapApiReportToView(report: ApiBuyerReport): BuyerReportView {
  return {
    id: report.id,
    searchJobId: report.search_job_id ?? "unknown-job",
    county: report.search_job?.county ?? null,
    state: report.search_job?.state ?? null,
    propertyType: report.search_job?.property_type ?? null,
    buyerName: report.buyer_name_snapshot ?? "Unknown buyer",
    mailingAddress: report.mailing_address_snapshot ?? "No mailing address",
    score: report.score ?? 0,
    purchaseCount: report.purchase_count ?? 0,
    totalSpend: Number(report.total_spend ?? 0),
    isLlc: Boolean(report.is_llc),
    isCashBuyer: Boolean(report.is_cash_buyer),
    buyerIdentityNote: getBuyerIdentityNote(report.BuyerProfile),
    createdAt: report.created_at,
  };
}

type BuyerProfileApi = {
  score_breakdown?: {
    buyer_identity?: {
      note?: string;
    };
  } | null;
};

function getBuyerIdentityNote(profile: BuyerProfileApi | BuyerProfileApi[] | null | undefined) {
  const resolved = Array.isArray(profile) ? profile[0] : profile;
  return resolved?.score_breakdown?.buyer_identity?.note ?? null;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeCsvValue(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
