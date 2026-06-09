import { NextRequest, NextResponse } from "next/server";

import { updateDealSignatureStatus } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      signatureStatus?: string;
      sentForSignatureAt?: string | null;
      signedBySellerAt?: string | null;
      signedByBuyerAt?: string | null;
      signatureProvider?: string;
      signaturePacketUrl?: string;
      signerEmail?: string;
      signerRole?: string;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await updateDealSignatureStatus({
      dealId: body.dealId.trim(),
      signatureStatus: body.signatureStatus,
      sentForSignatureAt: body.sentForSignatureAt ?? null,
      signedBySellerAt: body.signedBySellerAt ?? null,
      signedByBuyerAt: body.signedByBuyerAt ?? null,
      signatureProvider: body.signatureProvider,
      signaturePacketUrl: body.signaturePacketUrl,
      signerEmail: body.signerEmail,
      signerRole: body.signerRole,
    });
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    return NextResponse.json({ ok: true, message: "Signature status updated." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Signature update failed." },
      { status: 500 },
    );
  }
}
