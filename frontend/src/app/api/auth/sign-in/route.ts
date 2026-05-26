import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createPublicSupabaseAuthClient,
} from "@/lib/buyer-engine-auth";

export const dynamic = "force-dynamic";

function applyAuthCookies(response: NextResponse, accessToken: string, refreshToken: string) {
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60,
  });

  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        {
          ok: false,
          error: "Email and password are required.",
        },
        { status: 400 },
      );
    }

    const supabase = createPublicSupabaseAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      return NextResponse.json(
        {
          ok: false,
          error: error?.message ?? "Operator sign-in failed.",
        },
        { status: 401 },
      );
    }

    const response = NextResponse.json({
      ok: true,
      operator: {
        id: data.user.id,
        email: data.user.email ?? null,
      },
    });

    applyAuthCookies(response, data.session.access_token, data.session.refresh_token);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown operator sign-in failure.",
      },
      { status: 500 },
    );
  }
}
