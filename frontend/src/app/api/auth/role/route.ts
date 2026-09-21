import { NextResponse } from "next/server";

import { getOperatorContext } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getOperatorContext();
    return NextResponse.json({ ok: true, role: context.role, expiresAt: context.expiresAt, expired: context.expired });
  } catch {
    return NextResponse.json({ ok: true, role: "anonymous" });
  }
}
