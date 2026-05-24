import { NextResponse } from "next/server";

import {
  getLiveCountyCapabilities,
  getBuyerEngineEnvStatus,
} from "@/lib/buyer-engine-server";

export async function GET() {
  try {
    const counties = await getLiveCountyCapabilities(true);

    return NextResponse.json({
      ok: true,
      counties,
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown county source fetch failure.",
        counties: await getLiveCountyCapabilities(true),
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}
