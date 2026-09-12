import { captureBuyerDispatchAuthority } from "@/lib/buyer-dispatch-authority";
import { isBuyerDispatchUncertainError, scopedBuyerWriterEnabled } from "@/lib/buyer-scoped-dispatch";
import { guardAdminApiContext } from "@/lib/operator-access";
import { NextRequest, NextResponse } from "next/server";

import { launchBuyerSearchFromDeal, recordBuyerSearchDispatchFailure } from "@/lib/deal-engine-server";
import { triggerBuyerEngineWorkflow } from "@/lib/buyer-engine-server";

export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestStartedAt = performance.now();
  const gate = await guardAdminApiContext();
  if ("response" in gate) return gate.response;
  try {
    const authority = scopedBuyerWriterEnabled() ? await captureBuyerDispatchAuthority(gate, requestStartedAt) : null;
    const body = (await request.json()) as { dealId?: string };
    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await launchBuyerSearchFromDeal({ dealId: body.dealId.trim() }, authority);
    if (!result.ok) {
      const status =
        result.error.startsWith("Sign in required")
          ? 401
          : /hold launches|not approved|not configured|blocked/i.test(result.error)
            ? 422
            : 500;
      return NextResponse.json(result, { status });
    }

    try {
      await triggerBuyerEngineWorkflow(result.job, authority);
    } catch (error) {
      if (authority) {
        const uncertain = isBuyerDispatchUncertainError(error);
        // Scoped outcomes cannot safely use legacy unfenced Deal/conversation
        // rewrites or create an instruction to retry an uncertain transaction.
        if (uncertain) console.error("Buyer dispatch reconciliation required", {
          jobId: error.jobId, requestId: error.requestId, updatedAt: error.updatedAt,
        });
        return NextResponse.json({
          ok: true, job: result.job,
          workflow: { ...result.workflow, dispatch: uncertain ? "unknown" : "failed" },
          warning: uncertain ? "Buyer dispatch completion could not be confirmed." : "Buyer Engine scoped dispatch failed.",
          message: "Buyer search was created; this dispatch has no confirmed completion.",
        }, { status: 202 });
      }
      const message = error instanceof Error ? error.message : "Buyer Engine workflow dispatch failed.";
      await recordBuyerSearchDispatchFailure({
        dealId: body.dealId.trim(),
        jobId: result.job.id,
        error: message,
      }).catch(() => null);

      return NextResponse.json({
        ok: true,
        job: result.job,
        workflow: {
          ...result.workflow,
          dispatch: "failed",
        },
        warning: message,
        message: `Buyer search ${result.job.id} was created, but the external Buyer Engine workflow did not start cleanly. The deal was updated with a retry task instead of failing silently.`,
      }, { status: 202 });
    }

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
