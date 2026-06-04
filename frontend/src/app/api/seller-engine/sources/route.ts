import { NextRequest, NextResponse } from "next/server";

import {
  bootstrapSellerCountyStarterSources,
  createSellerSource,
  listSellerSources,
  listBuyerCountyRegistrySources,
  syncSellerSourcesFromBuyerRegistry,
  toggleSellerSourceActive,
} from "@/lib/seller-engine-server";

export async function GET() {
  return NextResponse.json({ ok: true, sources: await listSellerSources() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: string;
      name?: string;
      county?: string;
      sourceType?: string;
      sourceUrl?: string;
      integrationType?: string;
    };
    if (body.action === "bootstrap_starter_pack") {
      return NextResponse.json({ ok: true, ...(await bootstrapSellerCountyStarterSources()) });
    }
    if (body.action === "sync_from_buyer_registry") {
      return NextResponse.json({ ok: true, ...(await syncSellerSourcesFromBuyerRegistry()) });
    }
    if (body.action === "preview_buyer_registry") {
      return NextResponse.json({ ok: true, rows: await listBuyerCountyRegistrySources(true) });
    }
    if (!body.name || !body.sourceType) return NextResponse.json({ ok: false, error: "Source name and type are required." }, { status: 400 });
    return NextResponse.json({ ok: true, source: await createSellerSource({ name: body.name, county: body.county, sourceType: body.sourceType, sourceUrl: body.sourceUrl, integrationType: body.integrationType }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Source creation failed." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as { id?: string; active?: boolean };
    if (!body.id || typeof body.active !== "boolean") {
      return NextResponse.json({ ok: false, error: "id and active are required." }, { status: 400 });
    }
    await toggleSellerSourceActive(body.id, body.active);
    return NextResponse.json({ ok: true, id: body.id, active: body.active });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Source update failed." }, { status: 500 });
  }
}
