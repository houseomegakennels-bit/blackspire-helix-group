import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { listSellerLeadsForCapability } from "@/lib/seller-engine-server";

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

  let leads;
  try { leads = await listSellerLeadsForCapability(limit); }
  catch { return NextResponse.json({ ok: false, error: "Seller capability unavailable" }, { status: 503 }); }
  const opportunities = leads.map((lead) => ({
    leadId: lead.id, propertyId: lead.propertyId, propertyAddress: lead.propertyAddress,
    county: lead.county || null, city: lead.city || null, state: lead.state || null,
    postalCode: lead.zipCode || null, propertyType: lead.propertyType || null, status: lead.status,
    motivationScore: lead.score, category: lead.category, reasons: lead.reasons,
    recommendedAction: lead.recommendedAction || null, source: lead.sourceName,
  }));
  if (opportunities.some((row) => !row.propertyId)) return NextResponse.json({ ok: false, error: "canonical property identity unavailable" }, { status: 503 });
  return NextResponse.json({ opportunities, sourceSnapshotAt: new Date().toISOString() });
}
