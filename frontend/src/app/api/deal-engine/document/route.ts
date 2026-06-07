import { NextRequest, NextResponse } from "next/server";

import { downloadDealDocument } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dealId = request.nextUrl.searchParams.get("dealId")?.trim() || "";
  const documentId = request.nextUrl.searchParams.get("documentId")?.trim() || "";

  if (!dealId || !documentId) {
    return NextResponse.json({ ok: false, error: "dealId and documentId are required." }, { status: 400 });
  }

  const result = await downloadDealDocument(dealId, documentId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  }

  return new NextResponse(result.data, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="${result.fileName}"`,
    },
  });
}
