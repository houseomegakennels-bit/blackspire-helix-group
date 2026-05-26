import { NextRequest, NextResponse } from "next/server";

import type { OutreachDraftRecord } from "@/lib/outreach-drafts";
import {
  getBuyerEngineEnvStatus,
  listOutreachDraftRecords,
  persistOutreachDraftRecord,
} from "@/lib/buyer-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchJobId = request.nextUrl.searchParams.get("searchJobId")?.trim() || undefined;
    const drafts = await listOutreachDraftRecords(searchJobId);

    return NextResponse.json(
      {
        ok: true,
        supported: true,
        storage: "server",
        drafts,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        supported: false,
        storage: "browser",
        drafts: [],
        error: error instanceof Error ? error.message : "Unknown outreach draft fetch failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const record = (await request.json()) as Partial<OutreachDraftRecord>;

    if (
      !record ||
      typeof record !== "object" ||
      !record.id ||
      !record.searchJobId ||
      !record.buyerName ||
      !record.subject ||
      !record.body ||
      !record.createdAt
    ) {
      return NextResponse.json(
        {
          ok: false,
          supported: false,
          storage: "browser",
          error: "Outreach draft payload is missing required fields.",
        },
        { status: 400 },
      );
    }

    const drafts = await persistOutreachDraftRecord(record as OutreachDraftRecord);

    return NextResponse.json(
      {
        ok: true,
        supported: true,
        storage: "server",
        drafts,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        supported: false,
        storage: "browser",
        drafts: [],
        error: error instanceof Error ? error.message : "Unknown outreach draft persistence failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}
