import { productionCapabilityReadScope } from "@/lib/capability-read-client";
import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { readBoundedRequestBody } from "@/lib/bounded-request-body";
import { listDealEngineLeads } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try { return await handleRead(request); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
}

async function handleRead(request: NextRequest) {
  let body: unknown; let bodyBytes: string;
  try { bodyBytes = await readBoundedRequestBody(request); body = JSON.parse(bodyBytes); }
  catch { return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as { workspaceId?: unknown; limit?: unknown };
  const authority = await authorizeInternalCapability(request, bodyBytes, input.workspaceId, "deal.records.search");
  if (!authority) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (Object.keys(input).some((key) => !["workspaceId", "limit"].includes(key))) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const limit = Number(input.limit ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });

  let scope;
  try { scope = productionCapabilityReadScope(authority.bindingDigest); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
  let deals;
  try { deals = await listDealEngineLeads(limit, { readOnly: true, readClient: scope.client }); }
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

  return scope.respond({ deals: records, sourceSnapshotAt: new Date().toISOString() });
}
