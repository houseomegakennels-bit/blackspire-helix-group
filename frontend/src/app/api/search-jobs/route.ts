import { after, NextResponse } from "next/server";
import { getCountyLaunchBlock } from "@/lib/buyer-engine-data";
import { matchBuyerGroup } from "@/lib/buyer-groups";

import {
  listBuyerReports,
  createSearchJob,
  getBuyerEngineEnvStatus,
  listSearchJobs,
  triggerBuyerEngineWorkflow,
} from "@/lib/buyer-engine-server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const highlight = searchParams.get("highlight");
    const [jobs, highlightedReports] = await Promise.all([
      listSearchJobs(),
      highlight ? listBuyerReports(highlight).catch(() => []) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      ok: true,
      jobs,
      highlightedJobId: highlight,
      highlightedReports: highlightedReports.map((report) => ({
        ...report,
        buyer_group_match: matchBuyerGroup(report.buyer_name_snapshot),
      })),
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown search job fetch failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const state = typeof body.state === "string" ? body.state.trim() : "";
    const county = typeof body.county === "string" ? body.county.trim() : "";
    const propertyType = typeof body.propertyType === "string" ? body.propertyType.trim() : "";
    const dateRangeStart = typeof body.dateRangeStart === "string" ? body.dateRangeStart.trim() : "";
    const dateRangeEnd = typeof body.dateRangeEnd === "string" ? body.dateRangeEnd.trim() : "";
    const minPurchases = Number(body.minPurchases);
    const notes = typeof body.notes === "string" ? body.notes : "";

    if (!title || !state || !county || !propertyType || !dateRangeStart || !dateRangeEnd) {
      return NextResponse.json(
        {
          ok: false,
          error: "title, state, county, propertyType, dateRangeStart, and dateRangeEnd are required.",
        },
        { status: 400 },
      );
    }

    const rangeStart = new Date(dateRangeStart);
    const rangeEnd = new Date(dateRangeEnd);
    const isValidRange = !Number.isNaN(rangeStart.getTime()) && !Number.isNaN(rangeEnd.getTime()) && rangeStart <= rangeEnd;

    if (!isValidRange) {
      return NextResponse.json(
        {
          ok: false,
          error: "dateRangeStart and dateRangeEnd must form a valid chronological range.",
        },
        { status: 400 },
      );
    }

    if (!Number.isInteger(minPurchases) || minPurchases < 1 || minPurchases > 5) {
      return NextResponse.json(
        {
          ok: false,
          error: "minPurchases must be a whole number between 1 and 5.",
        },
        { status: 400 },
      );
    }

    const launchBlock = getCountyLaunchBlock(county, propertyType);
    if (launchBlock.blocked) {
      return NextResponse.json(
        {
          ok: false,
          error: launchBlock.reason,
          meta: {
            county,
            propertyType,
            reason: county.toLowerCase() === "wake" ? "known_timeout_risk" : "county_not_launchable",
          },
        },
        { status: 422 },
      );
    }

    const job = await createSearchJob({
      title,
      state,
      county,
      propertyType,
      dateRangeStart,
      dateRangeEnd,
      minPurchases,
      notes,
    });

    const workflow = {
      webhookUrl: `${process.env.N8N_WEBHOOK_BASE_URL?.replace(/\/$/, "") || "https://cpearson0312.app.n8n.cloud/webhook"}/buyer-engine`,
      dispatch: "queued",
    };

    after(async () => {
      try {
        await triggerBuyerEngineWorkflow(job);
      } catch (error) {
        console.error("Buyer Engine trigger failed:", error);
      }
    });

    return NextResponse.json({
      ok: true,
      job,
      workflow,
      message: "Search job stored and Buyer Engine triggered.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown search job creation failure.";
    const status = message.startsWith("Sign in required") ? 401 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: message,
        env: getBuyerEngineEnvStatus(),
      },
      { status },
    );
  }
}
