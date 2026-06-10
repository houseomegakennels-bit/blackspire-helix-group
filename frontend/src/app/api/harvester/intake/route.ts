import { NextRequest, NextResponse } from "next/server";

import { createHarvesterIntake, listHarvesterIntakes, type HarvesterSourceType } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const intakes = await listHarvesterIntakes();
    return NextResponse.json({ ok: true, intakes });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load Harvester intakes." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sourceType?: HarvesterSourceType;
      sourceName?: string;
      sourceUrl?: string;
      originalText?: string;
      originalFileUrl?: string;
      originalFileType?: string;
      propertyAddress?: string;
      county?: string;
      city?: string;
      state?: string;
      zip?: string;
      posterName?: string;
      notes?: string;
    };

    if (!body.sourceType) {
      return NextResponse.json({ ok: false, error: "sourceType is required." }, { status: 400 });
    }

    const result = await createHarvesterIntake({
      sourceType: body.sourceType,
      sourceName: body.sourceName,
      sourceUrl: body.sourceUrl,
      originalText: body.originalText,
      originalFileUrl: body.originalFileUrl,
      originalFileType: body.originalFileType,
      propertyAddress: body.propertyAddress,
      county: body.county,
      city: body.city,
      state: body.state,
      zip: body.zip,
      posterName: body.posterName,
      notes: body.notes,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to create Harvester intake." },
      { status: 500 },
    );
  }
}
