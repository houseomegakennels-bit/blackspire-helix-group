import { BuyerShell } from "@/components/buyer-shell";
import { SearchJobsMonitor } from "@/components/search-jobs-monitor";
import {
  getLiveCountyCapabilities,
  getBuyerEngineEnvStatus,
  getBuyerEngineRealtimeClientEnv,
  getOperatorShellStatus,
  listBuyerReports,
  listSearchJobs,
} from "@/lib/buyer-engine-server";

export default async function SearchJobsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const highlightedJobId =
    typeof resolvedSearchParams?.highlight === "string"
      ? resolvedSearchParams.highlight
      : undefined;

  const env = getBuyerEngineEnvStatus();
  const realtime = getBuyerEngineRealtimeClientEnv();
  const [countyCapabilities, liveJobs, highlightedReportRows, operatorStatus] = env.enabled
    ? await Promise.all([
        getLiveCountyCapabilities(true),
        listSearchJobs().catch(() => []),
        highlightedJobId ? listBuyerReports(highlightedJobId).catch(() => []) : Promise.resolve([]),
        getOperatorShellStatus().catch(() => null),
      ])
    : [[], [], [], null];
  // Real operator-scoped jobs only — no sample/reference fallback. An empty
  // array renders the monitor's genuine empty state instead of fake data.
  const jobs = liveJobs.map((job) => ({
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
  }));
  const highlightedReports = highlightedJobId && env.enabled
    ? highlightedReportRows.map((report) => ({
        id: report.id,
        buyerName: report.buyer_name_snapshot ?? "Unknown buyer",
        mailingAddress: report.mailing_address_snapshot ?? "No mailing address",
        score: report.score ?? 0,
        purchaseCount: report.purchase_count ?? 0,
        totalSpend: Number(report.total_spend ?? 0),
        isLlc: Boolean(report.is_llc),
        isCashBuyer: Boolean(report.is_cash_buyer),
        buyerIdentityNote: (Array.isArray(report.BuyerProfile) ? report.BuyerProfile[0] : report.BuyerProfile)
          ?.score_breakdown?.buyer_identity?.note ?? null,
      }))
    : [];

  return (
    <BuyerShell
      eyebrow="Dossiers"
      title="Search Jobs"
      description="This page now watches the live Buyer Engine queue and refreshes itself while jobs advance through the workflow."
      operatorStatus={operatorStatus}
    >
      <SearchJobsMonitor
        initialJobs={jobs}
        initialEnv={env}
        realtime={realtime}
        highlightedJobId={highlightedJobId}
        initialHighlightedReports={highlightedReports}
        countyCapabilities={countyCapabilities}
        operatorStatus={operatorStatus}
      />
    </BuyerShell>
  );
}
