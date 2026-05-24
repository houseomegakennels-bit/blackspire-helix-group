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
  loadOutreachDrafts,
  persistOutreachDraft,
  type OutreachDraftRecord,
} from "@/lib/outreach-drafts";

type SearchJobsEnv = {
  enabled: boolean;
  missing: string[];
  hasDefaultUserId: boolean;
};

type SearchJobView = {
  id: string;
  title: string;
  county: string;
  state: string;
  propertyType: string;
  status: "pending" | "processing" | "completed" | "failed";
  dateRange: string;
  buyersFound: number;
  salesAnalyzed: number;
  notes?: string;
};

type ApiSearchJob = {
  id: string;
  county: string;
  state: string;
  property_type: string;
  status: "pending" | "processing" | "completed" | "failed";
  date_range_start: string | null;
  date_range_end: string | null;
  total_buyers_found: number | null;
  total_sales_analyzed: number | null;
  error_message: string | null;
};

type SearchJobsPayload = {
  ok: boolean;
  jobs: ApiSearchJob[];
  highlightedJobId?: string | null;
  highlightedReports?: ApiBuyerReport[];
  env: SearchJobsEnv;
  error?: string;
};

type ApiBuyerReport = {
  id: string;
  buyer_name_snapshot: string | null;
  mailing_address_snapshot: string | null;
  score: number | null;
  purchase_count: number | null;
  total_spend: number | null;
  is_llc: boolean | null;
  is_cash_buyer: boolean | null;
};

type BuyerReportView = {
  id: string;
  buyerName: string;
  mailingAddress: string;
  score: number;
  purchaseCount: number;
  totalSpend: number;
  isLlc: boolean;
  isCashBuyer: boolean;
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

export function SearchJobsMonitor({
  initialJobs,
  initialEnv,
  highlightedJobId,
  initialHighlightedReports = [],
  countyCapabilities,
}: {
  initialJobs: SearchJobView[];
  initialEnv: SearchJobsEnv;
  highlightedJobId?: string;
  initialHighlightedReports?: BuyerReportView[];
  countyCapabilities: CountyCapability[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [env, setEnv] = useState(initialEnv);
  const [reports, setReports] = useState(initialHighlightedReports);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(new Date());
  const [dispatchingJobId, setDispatchingJobId] = useState<string | null>(null);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [savingExport, setSavingExport] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<OutreachDraftRecord[]>([]);

  const liveMode = env.enabled;
  const countyCapabilityMap = useMemo(
    () =>
      Object.fromEntries(
        countyCapabilities.map((county) => [county.county.trim().toLowerCase(), county]),
      ) as Record<string, CountyCapability>,
    [countyCapabilities],
  );

  const refreshJobs = useCallback(async () => {
    if (!liveMode) return;

    setLoading(true);
    try {
      const query = highlightedJobId ? `?highlight=${encodeURIComponent(highlightedJobId)}` : "";
      const response = await fetch(`/api/search-jobs${query}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as SearchJobsPayload;

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Search job refresh failed.");
        if (payload.env) setEnv(payload.env);
        return;
      }

      setJobs(payload.jobs.map(mapApiJobToView));
      setReports((payload.highlightedReports ?? []).map(mapApiReportToView));
      setEnv(payload.env);
      setLastCheckedAt(new Date());
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Search job refresh failed.");
    } finally {
      setLoading(false);
    }
  }, [highlightedJobId, liveMode]);

  useEffect(() => {
    if (!liveMode) return;

    const interval = window.setInterval(() => {
      void refreshJobs();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [liveMode, refreshJobs]);

  useEffect(() => {
    setSavedDrafts(highlightedJobId ? loadOutreachDrafts(highlightedJobId) : []);
  }, [highlightedJobId]);

  const activeSummary = useMemo(() => {
    const processing = jobs.filter((job) => job.status === "processing").length;
    const completed = jobs.filter((job) => job.status === "completed").length;
    const failed = jobs.filter((job) => job.status === "failed").length;

    return { processing, completed, failed };
  }, [jobs]);

  const highlightedJob = useMemo(
    () => jobs.find((job) => job.id === highlightedJobId),
    [jobs, highlightedJobId],
  );

  const highlightedSpend = useMemo(
    () => reports.reduce((sum, report) => sum + report.totalSpend, 0),
    [reports],
  );
  const highlightedRisk = highlightedJob
    ? getCountyOperationalRisk(highlightedJob.county, highlightedJob.propertyType)
    : null;
  const highlightedCapability = highlightedJob
    ? countyCapabilityMap[highlightedJob.county.trim().toLowerCase()] ??
      getCountyCapability(highlightedJob.county, countyCapabilities)
    : null;

  const exportHighlightedReports = useCallback(async () => {
    if (!highlightedJob || !reports.length) return;

    const rows = reports.map((report) => ({
      buyer_name: report.buyerName,
      mailing_address: report.mailingAddress,
      county: highlightedJob.county,
      state: highlightedJob.state,
      property_type: highlightedJob.propertyType,
      score: report.score,
      purchase_count: report.purchaseCount,
      total_spend: report.totalSpend,
      is_llc: report.isLlc ? "yes" : "no",
      is_cash_buyer: report.isCashBuyer ? "yes" : "no",
      search_job_id: highlightedJob.id,
    }));

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => escapeCsvValue(String(row[header as keyof typeof row] ?? "")))
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const fileName = `buyer-reports-${highlightedJob.id}.csv`;
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
          searchJobId: highlightedJob.id,
          fileName,
          rowCount: rows.length,
        }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string; export?: { file_name: string } };

      if (!response.ok || !payload.ok || !payload.export) {
        throw new Error(payload.error ?? "Export record could not be saved.");
      }

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
  }, [highlightedJob, liveMode, reports]);

  const copyHighlightedOutreachBrief = useCallback(async (report: BuyerReportView) => {
    if (!highlightedJob) return;

    const countyRisk = getCountyOperationalRisk(highlightedJob.county, highlightedJob.propertyType);
    const lines = [
      `Buyer: ${report.buyerName}`,
      `Mailing address: ${report.mailingAddress}`,
      `Market: ${highlightedJob.county}, ${highlightedJob.state}`,
      `Property type: ${highlightedJob.propertyType.replace("_", " ")}`,
      `Score: ${report.score}`,
      `Purchase count: ${report.purchaseCount}`,
      `Visible spend: ${formatMoney(report.totalSpend)}`,
      `Entity type: ${report.isLlc ? "LLC / entity" : "individual"}`,
      `Cash signal: ${report.isCashBuyer ? "cash buyer" : "not flagged"}`,
      `County risk: ${countyRisk.label} - ${countyRisk.message}`,
      `Search job: ${highlightedJob.id}`,
      "",
      "Suggested outreach angle:",
      report.isLlc
        ? "Reference repeat acquisition activity and ask whether the team is still buying land in this county."
        : "Reference recent land acquisition activity and ask whether they are still actively buying in this county.",
    ];

    await navigator.clipboard.writeText(lines.join("\n"));
    setCopiedReportId(report.id);
    window.setTimeout(() => {
      setCopiedReportId((current) => (current === report.id ? null : current));
    }, 2000);
  }, [highlightedJob]);

  const saveHighlightedDraft = useCallback(async (report: BuyerReportView) => {
    if (!highlightedJob) return;

    setSavingDraftId(report.id);
    setDraftStatus(null);
    try {
      const response = await fetch("/api/outreach-brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          searchJobId: highlightedJob.id,
          buyerName: report.buyerName,
          mailingAddress: report.mailingAddress,
          county: highlightedJob.county,
          state: highlightedJob.state,
          propertyType: highlightedJob.propertyType,
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
        source: "searches",
        searchJobId: highlightedJob.id,
        buyerName: report.buyerName,
        mailingAddress: report.mailingAddress,
        county: highlightedJob.county,
        state: highlightedJob.state,
        propertyType: highlightedJob.propertyType,
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

      setSavedDrafts(persistOutreachDraft(record).filter((draft) => draft.searchJobId === highlightedJob.id));
      await navigator.clipboard.writeText(payload.draft.body);
      setDraftStatus(`Draft saved for ${report.buyerName} and copied to clipboard.`);
    } catch (draftError) {
      setDraftStatus(draftError instanceof Error ? draftError.message : "Outreach draft generation failed.");
    } finally {
      setSavingDraftId(null);
    }
  }, [highlightedJob]);

  const copySavedDraft = useCallback(async (draft: OutreachDraftRecord) => {
    await navigator.clipboard.writeText(draft.body);
    setDraftStatus(`Saved draft copied for ${draft.buyerName}.`);
  }, []);

  const dispatchJob = useCallback(async (jobId: string) => {
    setDispatchingJobId(jobId);
    setError(null);

    try {
      const response = await fetch(`/api/search-jobs/${encodeURIComponent(jobId)}/trigger`, {
        method: "POST",
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Search job dispatch failed.");
        return;
      }

      await refreshJobs();
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "Search job dispatch failed.");
    } finally {
      setDispatchingJobId(null);
    }
  }, [refreshJobs]);

  return (
    <>
      {highlightedJobId ? (
        <Panel
          eyebrow="Fresh Launch"
          title="Highlighted job dossier"
          description="You were redirected here after launch. This panel stays focused on the selected job while the ledger keeps updating in the background."
        >
          <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone="warn" label="tracking newest job" />
                {highlightedJob ? <StatusPill tone={statusTone(highlightedJob.status)} label={highlightedJob.status} /> : null}
                {highlightedRisk ? <StatusPill tone={highlightedRisk.tone} label={highlightedRisk.label} /> : null}
                {highlightedCapability ? (
                  <StatusPill
                    tone={getCountyVerificationTone(highlightedCapability.verificationStatus)}
                    label={
                      highlightedCapability.verificationStatus === "approved"
                        ? "90-day ready"
                        : highlightedCapability.verificationStatus.replace(/_/g, " ")
                    }
                  />
                ) : null}
              </div>
              <div className="font-mono text-sm text-zinc-300">{highlightedJobId}</div>
              <div>
                <Link
                  href={`/buyers?searchJobId=${encodeURIComponent(highlightedJobId)}`}
                  className="inline-flex border border-white/10 bg-[hsl(222_16%_8%)] px-3 py-2 text-xs uppercase tracking-[0.22em] text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
                >
                  Open buyer dossiers
                </Link>
              </div>
              {reports.length ? (
                <div>
                  <button
                    type="button"
                    onClick={() => void exportHighlightedReports()}
                    disabled={savingExport}
                    className="inline-flex border border-white/10 bg-[hsl(222_16%_8%)] px-3 py-2 text-xs uppercase tracking-[0.22em] text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
                  >
                    {savingExport ? "Saving export..." : "Export CSV"}
                  </button>
                </div>
              ) : null}
              {highlightedJob ? (
                <dl className="space-y-2 text-sm text-zinc-300">
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">County</dt>
                    <dd>{highlightedJob.county}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Property type</dt>
                    <dd>{highlightedJob.propertyType}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Date range</dt>
                    <dd className="text-right tabular-nums">{highlightedJob.dateRange}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Buyer count</dt>
                    <dd className="tabular-nums">{highlightedJob.buyersFound}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Sales analyzed</dt>
                    <dd className="tabular-nums">{highlightedJob.salesAnalyzed}</dd>
                  </div>
                </dl>
              ) : null}
              {highlightedRisk ? (
                <p className="border border-white/10 bg-[hsl(222_14%_10%)] p-3 text-sm leading-6 text-zinc-300">
                  {highlightedRisk.message}
                </p>
              ) : null}
              {highlightedCapability ? (
                <p className="border border-white/10 bg-[hsl(222_14%_10%)] p-3 text-sm leading-6 text-zinc-400">
                  {highlightedCapability.verificationReason}
                </p>
              ) : null}
              {exportStatus ? (
                <p className="border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm leading-6 text-emerald-200">
                  {exportStatus}
                </p>
              ) : null}
              {draftStatus ? (
                <p className="border border-sky-500/20 bg-sky-500/10 p-3 text-sm leading-6 text-sky-200">
                  {draftStatus}
                </p>
              ) : null}
            </div>

            <div className="border border-white/10 bg-[hsl(222_14%_10%)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Top buyers</div>
                  <div className="mt-1 text-sm text-zinc-300">
                    {reports.length ? `${reports.length} buyer reports loaded` : "No buyer reports available yet for this job."}
                  </div>
                </div>
                {reports.length ? (
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Visible spend</div>
                    <div className="mt-1 text-lg font-semibold text-white tabular-nums">
                      {formatMoney(highlightedSpend)}
                    </div>
                  </div>
                ) : null}
              </div>

              {reports.length ? (
                <div className="mt-4 space-y-3">
                  {reports.map((report) => (
                    <div key={report.id} className="border border-white/10 bg-[hsl(222_16%_8%)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{report.buyerName}</div>
                          <div className="mt-1 text-xs text-zinc-500">{report.mailingAddress}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone={report.score >= 60 ? "active" : report.score >= 40 ? "warn" : "neutral"} label={`score ${report.score}`} />
                          {report.isLlc ? <StatusPill tone="good" label="llc" /> : null}
                          {report.isCashBuyer ? <StatusPill tone="warn" label="cash" /> : null}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                        <div>Purchases: <span className="tabular-nums">{report.purchaseCount}</span></div>
                        <div>Total spend: <span className="tabular-nums">{formatMoney(report.totalSpend)}</span></div>
                      </div>
                      <div className="mt-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void copyHighlightedOutreachBrief(report)}
                            className="border border-white/10 bg-[hsl(222_18%_7%)] px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
                          >
                            {copiedReportId === report.id ? "Copied" : "Copy outreach"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveHighlightedDraft(report)}
                            disabled={savingDraftId === report.id}
                            className="border border-white/10 bg-[hsl(222_18%_7%)] px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-zinc-200 transition hover:border-sky-400/35 hover:text-white disabled:opacity-60"
                          >
                            {savingDraftId === report.id ? "Saving..." : "Save draft"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {savedDrafts.length ? (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Saved drafts</div>
                  <div className="mt-3 space-y-3">
                    {savedDrafts.slice(0, 4).map((draft) => (
                      <div key={draft.id} className="border border-white/10 bg-[hsl(222_18%_7%)] p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">{draft.buyerName}</div>
                            <div className="mt-1 text-xs text-zinc-500">{draft.subject}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void copySavedDraft(draft)}
                            className="border border-white/10 bg-[hsl(222_16%_8%)] px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-zinc-200 transition hover:border-sky-400/35 hover:text-white"
                          >
                            Copy saved draft
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel
        eyebrow="Data Source"
        title={liveMode ? "Live search job records" : "Sample search job records"}
        description={
          liveMode
            ? "This page now polls the Buyer Engine API every five seconds so long-running workflow updates become visible without a manual refresh."
            : env.enabled
              ? "Supabase is configured, but no accessible rows were returned for the current default user."
              : `The repo is still missing env values: ${env.missing.join(", ")}`
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={liveMode ? "active" : "warn"} label={liveMode ? "live mode" : "fallback mode"} />
          <StatusPill tone={env.hasDefaultUserId ? "good" : "neutral"} label={env.hasDefaultUserId ? "default user configured" : "no default user id"} />
          <StatusPill tone="good" label={`${activeSummary.processing} processing`} />
          <StatusPill tone="active" label={`${activeSummary.completed} completed`} />
          {activeSummary.failed ? <StatusPill tone="bad" label={`${activeSummary.failed} failed`} /> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
          <button
            type="button"
            onClick={() => void refreshJobs()}
            disabled={!liveMode || loading}
            className="border border-white/10 bg-[hsl(222_14%_10%)] px-3 py-2 text-zinc-200 disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh now"}
          </button>
          <span>Last checked: {lastCheckedAt ? lastCheckedAt.toLocaleTimeString() : "not yet"}</span>
          {error ? <span className="text-rose-300">{error}</span> : null}
        </div>
      </Panel>

      <Panel
        eyebrow="Job Ledger"
        title="Recent runs and current bottlenecks"
        description="Wake is the county to watch right now. The monitor keeps the ledger fresh while those runs move from pending into workflow execution."
      >
        <div className="overflow-hidden border border-white/10">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[hsl(222_16%_9%)] text-zinc-400">
              <tr>
                <th className="border-b border-white/10 px-4 py-3 font-medium">Search Job</th>
                <th className="border-b border-white/10 px-4 py-3 font-medium">Status</th>
                <th className="border-b border-white/10 px-4 py-3 font-medium">Date Range</th>
                <th className="border-b border-white/10 px-4 py-3 font-medium">Buyers</th>
                <th className="border-b border-white/10 px-4 py-3 font-medium">Sales</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                (() => {
                  const countyRisk = getCountyOperationalRisk(job.county, job.propertyType);
                  const countyCapability =
                    countyCapabilityMap[job.county.trim().toLowerCase()] ??
                    getCountyCapability(job.county, countyCapabilities);
                  return (
                <tr
                  key={job.id}
                  className={`border-b border-white/5 text-zinc-200 ${
                    job.id === highlightedJobId
                      ? "bg-[hsl(38_92%_55%/.10)]"
                      : "bg-[hsl(222_14%_10%)]"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="font-medium text-white">{job.title}</div>
                      {job.id === highlightedJobId ? (
                        <StatusPill tone="warn" label="new" />
                      ) : null}
                      <StatusPill tone={countyRisk.tone} label={countyRisk.label} />
                      {countyCapability ? (
                        <StatusPill
                          tone={getCountyVerificationTone(countyCapability.verificationStatus)}
                          label={
                            countyCapability.verificationStatus === "approved"
                              ? "90-day ready"
                              : countyCapability.verificationStatus.replace(/_/g, " ")
                          }
                        />
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {job.state} / {job.county} / {job.propertyType}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-zinc-600">{job.id}</div>
                    <div className="mt-2">
                      <Link
                        href={`/buyers?searchJobId=${encodeURIComponent(job.id)}`}
                        className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 underline-offset-4 hover:text-white hover:underline"
                      >
                        View buyer dossiers
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">{countyRisk.message}</div>
                    {countyCapability ? (
                      <div className="mt-1 text-xs text-zinc-500">{countyCapability.verificationReason}</div>
                    ) : null}
                    {job.notes ? <div className="mt-1 text-xs text-zinc-500">{job.notes}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={statusTone(job.status)} label={job.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">{job.dateRange}</td>
                  <td className="px-4 py-3 tabular-nums">{job.buyersFound}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <div>{job.salesAnalyzed}</div>
                    {job.status !== "processing" ? (
                      <button
                        type="button"
                        onClick={() => void dispatchJob(job.id)}
                        disabled={dispatchingJobId === job.id}
                        className="mt-2 border border-white/10 bg-[hsl(222_16%_8%)] px-2 py-1 text-[11px] uppercase tracking-[0.22em] text-zinc-200 disabled:opacity-60"
                      >
                        {dispatchingJobId === job.id ? "Queueing..." : job.status === "failed" ? "Retry" : "Dispatch"}
                      </button>
                    ) : null}
                  </td>
                </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function mapApiJobToView(job: ApiSearchJob): SearchJobView {
  return {
    id: job.id,
    title: `${job.county} ${job.property_type.replace("_", " ")} buyers sweep`,
    county: job.county,
    state: job.state,
    propertyType: job.property_type,
    status: job.status,
    dateRange: `${job.date_range_start ?? "n/a"} to ${job.date_range_end ?? "n/a"}`,
    buyersFound: job.total_buyers_found ?? 0,
    salesAnalyzed: job.total_sales_analyzed ?? 0,
    notes: job.error_message ?? undefined,
  };
}

function mapApiReportToView(report: ApiBuyerReport): BuyerReportView {
  return {
    id: report.id,
    buyerName: report.buyer_name_snapshot ?? "Unknown buyer",
    mailingAddress: report.mailing_address_snapshot ?? "No mailing address",
    score: report.score ?? 0,
    purchaseCount: report.purchase_count ?? 0,
    totalSpend: Number(report.total_spend ?? 0),
    isLlc: Boolean(report.is_llc),
    isCashBuyer: Boolean(report.is_cash_buyer),
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusTone(status: "pending" | "processing" | "completed" | "failed") {
  if (status === "completed") return "active";
  if (status === "processing") return "good";
  if (status === "failed") return "bad";
  return "neutral";
}

function escapeCsvValue(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
