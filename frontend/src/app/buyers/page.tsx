import { BuyerShell } from "@/components/buyer-shell";
import { BuyerReportsMonitor } from "@/components/buyer-reports-monitor";
import {
  getLiveCountyCapabilities,
  getBuyerEngineEnvStatus,
  getSearchJobById,
  listAllBuyerReports,
  listSearchJobsByIds,
} from "@/lib/buyer-engine-server";

export default async function BuyersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const searchJobId =
    typeof resolvedSearchParams?.searchJobId === "string"
      ? resolvedSearchParams.searchJobId
      : undefined;

  const env = getBuyerEngineEnvStatus();
  const [countyCapabilities, liveReports] = env.enabled
    ? await Promise.all([
        getLiveCountyCapabilities(true),
        listAllBuyerReports({ searchJobId }).catch(() => []),
      ])
    : [[], []];
  const relatedJobs = env.enabled
    ? searchJobId
      ? await getSearchJobById(searchJobId).then((job) => (job ? [job] : [])).catch(() => [])
      : await listSearchJobsByIds(
          liveReports
            .map((report) => report.search_job_id)
            .filter((id): id is string => Boolean(id)),
        ).catch(() => [])
    : [];
  const jobMap = Object.fromEntries(
    relatedJobs.map((job) => [
      job.id,
      {
        county: job.county,
        state: job.state,
        propertyType: job.property_type,
      },
    ]),
  );
  const reports = liveReports.map((report) => ({
    id: report.id,
    searchJobId: report.search_job_id ?? "unknown-job",
    county: report.search_job_id ? (jobMap[report.search_job_id]?.county ?? null) : null,
    state: report.search_job_id ? (jobMap[report.search_job_id]?.state ?? null) : null,
    propertyType: report.search_job_id ? (jobMap[report.search_job_id]?.propertyType ?? null) : null,
    buyerName: report.buyer_name_snapshot ?? "Unknown buyer",
    mailingAddress: report.mailing_address_snapshot ?? "No mailing address",
    score: report.score ?? 0,
    purchaseCount: report.purchase_count ?? 0,
    totalSpend: Number(report.total_spend ?? 0),
    isLlc: Boolean(report.is_llc),
    isCashBuyer: Boolean(report.is_cash_buyer),
    createdAt: report.created_at,
  }));

  return (
    <BuyerShell
      eyebrow="Weapons"
      title="Buyer Reports"
      description={
        searchJobId
          ? `This route is focused on buyer reports for search job ${searchJobId}.`
          : "This route turns completed workflow output into a usable buyer-intelligence surface for ranking, scanning, and outreach prep."
      }
    >
      <BuyerReportsMonitor
        initialReports={reports}
        initialEnv={env}
        searchJobId={searchJobId}
        countyCapabilities={countyCapabilities}
      />
    </BuyerShell>
  );
}
