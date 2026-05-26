import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  countAuthUsers,
  createAdminSupabaseAuthClient,
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
    const existingUsers = await countAuthUsers();
    if (existingUsers > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Bootstrap is closed because operator accounts already exist.",
        },
        { status: 409 },
      );
    }

    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        {
          ok: false,
          error: "A valid email and a password of at least 8 characters are required.",
        },
        { status: 400 },
      );
    }

    const admin = createAdminSupabaseAuthClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      return NextResponse.json(
        {
          ok: false,
          error: createError?.message ?? "Operator bootstrap failed.",
        },
        { status: 500 },
      );
    }

    const publicAuth = createPublicSupabaseAuthClient();
    const { data: signedIn, error: signInError } = await publicAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signedIn.session || !signedIn.user) {
      return NextResponse.json(
        {
          ok: false,
          error: signInError?.message ?? "Bootstrap succeeded but sign-in failed.",
        },
        { status: 500 },
      );
    }

    const response = NextResponse.json({
      ok: true,
      operator: {
        id: signedIn.user.id,
        email: signedIn.user.email ?? null,
      },
    });

    applyAuthCookies(response, signedIn.session.access_token, signedIn.session.refresh_token);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown operator bootstrap failure.",
      },
      { status: 500 },
    );
  }
}
