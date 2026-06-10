import { NextRequest, NextResponse } from "next/server";

import {
  archiveInboxItem,
  listSentinelInboxItems,
  markInboxItemRead,
  resolveInboxItem,
  type SentinelInboxItem,
} from "@/lib/sentinel-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("statuses");
    const statuses = statusParam
      ? (statusParam.split(",").map((s) => s.trim()) as Array<SentinelInboxItem["status"]>)
      : undefined;
    const items = await listSentinelInboxItems({ statuses });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load the Sentinel inbox." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; action?: "read" | "resolve" | "archive" };
    if (!body.id || !body.action) {
      return NextResponse.json({ ok: false, error: "id and action are required." }, { status: 400 });
    }
    const result =
      body.action === "read"
        ? await markInboxItemRead(body.id)
        : body.action === "resolve"
          ? await resolveInboxItem(body.id)
          : body.action === "archive"
            ? await archiveInboxItem(body.id)
            : { ok: false as const, error: "Unknown action." };
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to update the inbox item." },
      { status: 500 },
    );
  }
}
