import { NextRequest, NextResponse } from "next/server";

import { launchBuyerSearchFromDeal } from "@/lib/deal-engine-server";
import { triggerBuyerEngineWorkflow } from "@/lib/buyer-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dealId?: string };
    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await launchBuyerSearchFromDeal({ dealId: body.dealId.trim() });
    if (!result.ok) {
      const status =
        result.error.startsWith("Sign in required")
          ? 401
          : /hold launches|not approved|not configured|blocked/i.test(result.error)
            ? 422
            : 500;
      return NextResponse.json(result, { status });
    }

    await triggerBuyerEngineWorkflow(result.job);

    return NextResponse.json({
      ok: true,
      job: result.job,
      workflow: result.workflow,
      message: `Buyer Engine search ${result.job.id} launched for ${body.dealId}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Buyer search launch failed." },
      { status: 500 },
    );
  }
}
