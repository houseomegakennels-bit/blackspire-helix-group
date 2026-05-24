import { NextRequest, NextResponse } from "next/server";

import {
  getBuyerEngineEnvStatus,
  listAllBuyerReports,
  getSearchJobById,
  listSearchJobsByIds,
} from "@/lib/buyer-engine-server";

export async function GET(request: NextRequest) {
  try {
    const searchJobId = request.nextUrl.searchParams.get("searchJobId")?.trim() || undefined;
    const reports = await listAllBuyerReports({ searchJobId });
    const jobs = searchJobId
      ? await getSearchJobById(searchJobId).then((job) => (job ? [job] : [])).catch(() => [])
      : await listSearchJobsByIds(
          reports
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
      reports: reports.map((report) => ({
        ...report,
        search_job: report.search_job_id ? (jobMap[report.search_job_id] ?? null) : null,
      })),
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
