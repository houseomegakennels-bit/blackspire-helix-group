import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createAdminSupabaseAuthClient,
  createPublicSupabaseAuthClient,
  getAuthenticatedOperator,
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
    const operator = await getAuthenticatedOperator();
    if (!operator?.id || !operator.email) {
      return NextResponse.json(
        {
          ok: false,
          error: "Sign in required before changing the operator password.",
        },
        { status: 401 },
      );
    }

    const body = await request.json();
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return NextResponse.json(
        {
          ok: false,
          error: "Current password and a new password of at least 8 characters are required.",
        },
        { status: 400 },
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        {
          ok: false,
          error: "New password must be different from the current password.",
        },
        { status: 400 },
      );
    }

    const publicAuth = createPublicSupabaseAuthClient();
    const { error: verifyError } = await publicAuth.auth.signInWithPassword({
      email: operator.email,
      password: currentPassword,
    });

    if (verifyError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Current password is incorrect.",
        },
        { status: 401 },
      );
    }

    const admin = createAdminSupabaseAuthClient();
    const { error: updateError } = await admin.auth.admin.updateUserById(operator.id, {
      password: newPassword,
    });

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: updateError.message,
        },
        { status: 500 },
      );
    }

    const { data: signedIn, error: signInError } = await publicAuth.auth.signInWithPassword({
      email: operator.email,
      password: newPassword,
    });

    if (signInError || !signedIn.session || !signedIn.user) {
      return NextResponse.json(
        {
          ok: false,
          error: signInError?.message ?? "Password changed, but the new session could not be created.",
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
      message: "Password changed.",
    });

    applyAuthCookies(response, signedIn.session.access_token, signedIn.session.refresh_token);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown password change failure.",
      },
      { status: 500 },
    );
  }
}
