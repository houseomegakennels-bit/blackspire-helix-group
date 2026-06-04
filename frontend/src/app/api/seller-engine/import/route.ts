import { NextRequest, NextResponse } from "next/server";

import { importSellerCsv } from "@/lib/seller-engine-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "CSV file is required." }, { status: 400 });
    const result = await importSellerCsv({
      csv: await file.text(),
      sourceName: String(form.get("sourceName") || file.name),
      sourceType: String(form.get("sourceType") || "public_records"),
      county: String(form.get("county") || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CSV import failed." }, { status: 500 });
  }
}

