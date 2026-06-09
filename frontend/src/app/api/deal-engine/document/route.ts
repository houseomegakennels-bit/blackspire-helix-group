import { NextRequest, NextResponse } from "next/server";

import { downloadDealDocument, listDealDocuments } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dealId = request.nextUrl.searchParams.get("dealId")?.trim() || "";
  const documentId = request.nextUrl.searchParams.get("documentId")?.trim() || "";
  const category = request.nextUrl.searchParams.get("category")?.trim() || "";

  if (!dealId) {
    return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
  }

  if (!documentId) {
    const documents = await listDealDocuments(dealId, category || undefined);
    return NextResponse.json({ ok: true, documents });
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
