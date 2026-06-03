import { NextRequest, NextResponse } from "next/server";

import { ingestSamGovOpportunities } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Recon Engine opportunity ingest.
 * Runs on a Vercel cron schedule (see vercel.json) and can be triggered
 * manually. If CRON_SECRET is set, requests must present it (Vercel cron sends
 * it automatically as a Bearer token); if unset, the endpoint is open so it can
 * be triggered manually during setup.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  return auth === `Bearer ${secret}` || key === secret;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "25");
    const analyzeMax = Number(url.searchParams.get("analyzeMax") ?? "8");
    const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? "30");
    const state = url.searchParams.get("state") ?? "NC";

    const summary = await ingestSamGovOpportunities({
      limit: Number.isFinite(limit) ? limit : 25,
      analyzeMax: Number.isFinite(analyzeMax) ? analyzeMax : 8,
      lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : 30,
      state,
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Ingest failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
