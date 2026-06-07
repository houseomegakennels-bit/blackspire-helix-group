import { NextRequest, NextResponse } from "next/server";

import { uploadDealDocument } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const dealId = String(form.get("dealId") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const owner = String(form.get("owner") ?? "").trim() || "Blackspire operator";
    const status = String(form.get("status") ?? "").trim() || "Received";
    const notes = String(form.get("notes") ?? "").trim();
    const source = String(form.get("source") ?? "").trim() || "internal";
    const file = form.get("file");

    if (!dealId || !category || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "dealId, category, and file are required." },
        { status: 400 },
      );
    }

    const result = await uploadDealDocument({
      dealId,
      category,
      fileName: file.name || "document",
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
      owner,
      status,
      notes,
      source,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Document uploaded.", documentId: result.documentId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Document upload failed." },
      { status: 500 },
    );
  }
}
