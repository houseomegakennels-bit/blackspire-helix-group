import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { listDealEngineLeads } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as { workspaceId?: unknown; limit?: unknown };
  if (!authorizeInternalCapability(request, input.workspaceId)) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (Object.keys(input).some((key) => !["workspaceId", "limit"].includes(key))) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const limit = Number(input.limit ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });

  let deals;
  try { deals = await listDealEngineLeads(limit); }
  catch { return NextResponse.json({ ok: false, error: "Deal capability unavailable" }, { status: 503 }); }

  const records = deals.map((lead) => ({
    dealId: lead.id,
    propertyAddress: lead.propertyAddress,
    county: lead.county || null,
    status: lead.status,
    motivationScore: lead.motivationScore,
    mao: lead.mao,
    assignmentFee: lead.assignmentFee,
    exitStrategy: lead.exitStrategy,
    nextAction: lead.nextAction || null,
    dealRating: null,
    readyForContract: false,
    missingInputs: [],
  }));

  return NextResponse.json({ deals: records, sourceSnapshotAt: new Date().toISOString() });
}
