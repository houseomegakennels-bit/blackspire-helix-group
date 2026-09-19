import { productionCapabilityReadScope } from "@/lib/capability-read-client";
import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { readBoundedRequestBody } from "@/lib/bounded-request-body";
import { listSellerLeadsForCapability } from "@/lib/seller-engine-server";

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
  const authority = await authorizeInternalCapability(request, bodyBytes, input.workspaceId, "seller.opportunities.search");
  if (!authority) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (Object.keys(input).some((key) => !["workspaceId", "limit"].includes(key))) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const limit = Number(input.limit ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });

  let scope;
  try { scope = productionCapabilityReadScope(authority.bindingDigest); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
  let leads;
  try { leads = await listSellerLeadsForCapability(limit, scope.client); }
  catch { return NextResponse.json({ ok: false, error: "Seller capability unavailable" }, { status: 503 }); }
  const opportunities = leads.map((lead) => ({
    leadId: lead.id, propertyId: lead.propertyId, propertyAddress: lead.propertyAddress,
    county: lead.county || null, city: lead.city || null, state: lead.state || null,
    postalCode: lead.zipCode || null, propertyType: lead.propertyType || null, status: lead.status,
    motivationScore: lead.score, category: lead.category, reasons: lead.reasons,
    recommendedAction: lead.recommendedAction || null, source: lead.sourceName,
  }));
  if (opportunities.some((row) => !row.propertyId)) return NextResponse.json({ ok: false, error: "canonical property identity unavailable" }, { status: 503 });
  return scope.respond({ opportunities, sourceSnapshotAt: new Date().toISOString() });
}
