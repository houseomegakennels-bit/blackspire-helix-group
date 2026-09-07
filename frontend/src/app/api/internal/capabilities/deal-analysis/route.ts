import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { getDealEngineDealDetail } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as { workspaceId?: unknown; dealId?: unknown };
  if (!authorizeInternalCapability(request, input.workspaceId)) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (Object.keys(input).some((key) => !["workspaceId", "dealId"].includes(key))) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const dealId = typeof input.dealId === "string" ? input.dealId.trim() : "";
  if (!/^DE-\d{4}$/.test(dealId)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });

  let detail;
  try { detail = await getDealEngineDealDetail(dealId, { persistScaffold: false }); }
  catch { return NextResponse.json({ ok: false, error: "Deal capability unavailable" }, { status: 503 }); }

  if (!detail) return NextResponse.json({ found: false, dealId, sourceSnapshotAt: new Date().toISOString() });

  const { lead, underwriting } = detail;

  return NextResponse.json({
    found: true,
    dealId: lead.id,
    propertyAddress: lead.propertyAddress,
    county: lead.county || null,
    status: lead.status,
    motivationScore: lead.motivationScore,
    estimatedArv: underwriting.estimatedArv,
    sellerAskingPrice: underwriting.sellerAskingPrice,
    repairEstimate: underwriting.repairEstimate,
    closingCosts: underwriting.closingCosts,
    holdingCosts: underwriting.holdingCosts,
    buyerProfitTarget: underwriting.buyerProfitTarget,
    assignmentFeeTarget: underwriting.assignmentFeeTarget,
    rentalEstimate: underwriting.rentalEstimate,
    flipEstimate: underwriting.flipEstimate,
    purchasePriceTarget: underwriting.purchasePriceTarget,
    maximumAllowableOffer: underwriting.maximumAllowableOffer,
    wholesaleSpread: underwriting.wholesaleSpread,
    dealRating: underwriting.dealRating,
    missingInputs: underwriting.missingInputs,
    readyForContract: underwriting.readyForContract,
    compliance: underwriting.compliance,
    sourceSnapshotAt: new Date().toISOString(),
  });
}
