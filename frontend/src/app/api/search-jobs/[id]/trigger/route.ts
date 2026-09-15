import { captureBuyerDispatchAuthority } from "@/lib/buyer-dispatch-authority";
import { isBuyerDispatchUncertainError, scopedBuyerWriterEnabled } from "@/lib/buyer-scoped-dispatch";
import { guardAdminApiContext } from "@/lib/operator-access";
import { after, NextResponse } from "next/server";

import {
  getBuyerEngineEnvStatus,
  getSearchJobById,
  triggerBuyerEngineWorkflow,
} from "@/lib/buyer-engine-server";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestStartedAt = performance.now();
  const gate = await guardAdminApiContext();
  if ("response" in gate) return gate.response;
  try {
    const authority = scopedBuyerWriterEnabled() ? await captureBuyerDispatchAuthority(gate, requestStartedAt) : null;
    const { id } = await context.params;
    const job = await getSearchJobById(id, authority);

    if (!job) {
      return NextResponse.json(
        {
          ok: false,
          error: "Search job not found for the current default user.",
          env: getBuyerEngineEnvStatus(),
        },
        { status: 404 },
      );
    }

    const workflow = {
      webhookUrl: `${process.env.N8N_WEBHOOK_BASE_URL?.replace(/\/$/, "") || "https://cpearson0312.app.n8n.cloud/webhook"}/buyer-engine`,
      dispatch: "queued",
    };

    after(async () => {
      try {
        await triggerBuyerEngineWorkflow(job, authority);
      } catch (error) {
        if (isBuyerDispatchUncertainError(error)) {
          console.error("Buyer dispatch reconciliation required", {
            jobId: error.jobId, requestId: error.requestId, updatedAt: error.updatedAt,
          });
        } else {
          console.error("Buyer Engine retrigger failed:", error);
        }
      }
    });

    return NextResponse.json({
      ok: true,
      job,
      workflow,
      message: "Buyer Engine dispatch queued for the selected search job.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown search job trigger failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}

