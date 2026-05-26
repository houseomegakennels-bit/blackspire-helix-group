import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
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

function cleanOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = cleanOptionalText(body.fullName, 120);
    const company = cleanOptionalText(body.company, 120);
    const useCase = cleanOptionalText(body.useCase, 500);
    const website = cleanOptionalText(body.website, 200);

    if (website) {
      return NextResponse.json(
        {
          ok: false,
          error: "Access request could not be accepted.",
        },
        { status: 400 },
      );
    }

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
      user_metadata: {
        full_name: fullName || null,
        company: company || null,
        beta_use_case: useCase || null,
        access_source: "public_beta_signup",
        access_requested_at: new Date().toISOString(),
      },
    });

    if (createError || !created.user) {
      const alreadyRegistered = createError?.message.toLowerCase().includes("already");
      return NextResponse.json(
        {
          ok: false,
          error: alreadyRegistered
            ? "That email already has access. Sign in instead."
            : createError?.message ?? "Beta sign-up failed.",
        },
        { status: alreadyRegistered ? 409 : 500 },
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
          error: signInError?.message ?? "Account created, but sign-in failed.",
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
      message: "Beta access created. You are signed in.",
    });

    applyAuthCookies(response, signedIn.session.access_token, signedIn.session.refresh_token);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown beta sign-up failure.",
      },
      { status: 500 },
    );
  }
}
