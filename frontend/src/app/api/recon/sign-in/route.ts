import { NextRequest, NextResponse } from "next/server";

import { authenticateReconAccount, buildSessionCookie } from "@/lib/recon-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email ?? "").trim();
    const password = body.password ?? "";
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
    }

    const account = await authenticateReconAccount(email, password);
    const response = NextResponse.json({ ok: true, account });
    const cookie = buildSessionCookie(account.id);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    const status = /invalid email or password/i.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
