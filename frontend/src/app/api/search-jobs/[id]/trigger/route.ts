import { after, NextResponse } from "next/server";

import {
  getBuyerEngineEnvStatus,
  getSearchJobById,
  triggerBuyerEngineWorkflow,
} from "@/lib/buyer-engine-server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const job = await getSearchJobById(id);

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
        await triggerBuyerEngineWorkflow(job);
      } catch (error) {
        console.error("Buyer Engine retrigger failed:", error);
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

