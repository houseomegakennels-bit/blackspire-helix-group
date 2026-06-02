import { NextRequest, NextResponse } from "next/server";

import { createHelixLawnLead, listHelixLawnLeads } from "@/lib/helix-lawn-command-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const leads = await listHelixLawnLeads(24);
    return NextResponse.json({
      ok: true,
      total: leads.length,
      leads,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load lawn leads.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const lead = await createHelixLawnLead(body);

    return NextResponse.json({
      ok: true,
      lead,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save lawn lead.";
    const status = /required/i.test(message) ? 400 : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
