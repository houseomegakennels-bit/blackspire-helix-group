import { NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

// Retired direct paid-provider entrypoint. Do not parse input, load the queue,
// or import the enrichment implementation, even for an authenticated admin.
export async function POST() {
  const denied = await guardAdminApi();
  if (denied) return denied;
  return NextResponse.json(
    { ok: false, error: "Direct Nexus trace is retired. Nexus status remains available." },
    { status: 410 },
  );
}
