import { productionCapabilityReadScope } from "@/lib/capability-read-client";
import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { getDealEngineAnalysisForCapability } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try { return await handleRead(request); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
}

async function handleRead(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as { workspaceId?: unknown; dealId?: unknown };
  if (!authorizeInternalCapability(request, input.workspaceId)) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (Object.keys(input).some((key) => !["workspaceId", "dealId"].includes(key))) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const dealId = typeof input.dealId === "string" ? input.dealId.trim() : "";
  if (!/^DE-\d{4}$/.test(dealId)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });

  let scope;
  try { scope = productionCapabilityReadScope(); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
  let detail;
  try { detail = await getDealEngineAnalysisForCapability(dealId, scope.client); }
  catch { return NextResponse.json({ ok: false, error: "Deal capability unavailable" }, { status: 503 }); }

  if (!detail) return scope.respond({ found: false, dealId, sourceSnapshotAt: new Date().toISOString() });

  const { lead, underwriting } = detail;

  return scope.respond({
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
