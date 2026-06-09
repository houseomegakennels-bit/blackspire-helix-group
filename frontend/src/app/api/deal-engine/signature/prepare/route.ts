import { NextRequest, NextResponse } from "next/server";

import { prepareDealSignaturePacket } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      signatureProvider?: string;
      signerEmail?: string;
      signerRole?: string;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await prepareDealSignaturePacket({
      dealId: body.dealId.trim(),
      signatureProvider: body.signatureProvider?.trim(),
      signerEmail: body.signerEmail?.trim(),
      signerRole: body.signerRole?.trim(),
    });
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    return NextResponse.json({ ok: true, packetUrl: result.packetUrl, message: "Signature packet prepared." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Signature prep failed." },
      { status: 500 },
    );
  }
}
