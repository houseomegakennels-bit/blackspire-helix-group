import { NextResponse } from "next/server";

import { getOperatorRole } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const role = await getOperatorRole();
    return NextResponse.json({ ok: true, role });
  } catch {
    return NextResponse.json({ ok: true, role: "anonymous" });
  }
}
