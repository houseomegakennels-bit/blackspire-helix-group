import { NextRequest, NextResponse } from "next/server";

import { matchBuyerGroup } from "@/lib/buyer-groups";
import {
  getBuyerEngineEnvStatus,
  listAllBuyerReports,
  getSearchJobById,
  listSearchJobsByIds,
} from "@/lib/buyer-engine-server";

export async function GET(request: NextRequest) {
  try {
    const searchJobId = request.nextUrl.searchParams.get("searchJobId")?.trim() || undefined;
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    const offsetParam = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100) : 20;
    const offset = Number.isFinite(offsetParam) ? Math.max(Math.floor(offsetParam), 0) : 0;
    const reportPage = await listAllBuyerReports({ searchJobId, limit, offset });
    const jobs = searchJobId
      ? await getSearchJobById(searchJobId).then((job) => (job ? [job] : [])).catch(() => [])
      : await listSearchJobsByIds(
          reportPage.reports
            .map((report) => report.search_job_id)
            .filter((id): id is string => Boolean(id)),
        );
    const jobMap = Object.fromEntries(
      jobs.map((job) => [
        job.id,
        {
          county: job.county,
          state: job.state,
          property_type: job.property_type,
          status: job.status,
        },
      ]),
    );

    return NextResponse.json({
      ok: true,
      reports: reportPage.reports.map((report) => ({
        ...report,
        search_job: report.search_job_id ? (jobMap[report.search_job_id] ?? null) : null,
        buyer_group_match: matchBuyerGroup(report.buyer_name_snapshot),
      })),
      total: reportPage.total,
      limit: reportPage.limit,
      offset: reportPage.offset,
      hasMore: reportPage.offset + reportPage.reports.length < reportPage.total,
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown buyer report fetch failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}
