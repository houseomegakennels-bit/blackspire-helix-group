import { NextRequest, NextResponse } from "next/server";

import { buildSessionCookie, createReconAccount } from "@/lib/recon-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const account = await createReconAccount({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      companyName: typeof body.companyName === "string" ? body.companyName : undefined,
      industry: typeof body.industry === "string" ? body.industry : undefined,
      serviceKeywords:
        typeof body.services === "string"
          ? body.services.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      countiesServed: typeof body.county === "string" && body.county.trim() ? [body.county.trim()] : undefined,
      referredBy: typeof body.referredBy === "string" ? body.referredBy : null,
    });

    const response = NextResponse.json({ ok: true, account });
    const cookie = buildSessionCookie(account.id);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-up failed.";
    const status = /already exists|valid email|at least/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
