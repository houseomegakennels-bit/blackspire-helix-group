import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createAdminSupabaseAuthClient,
  createPublicSupabaseAuthClient,
} from "@/lib/buyer-engine-auth";

export const dynamic = "force-dynamic";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function applyAuthCookies(response: NextResponse, accessToken: string, refreshToken: string) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 });
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 14 });
}

export async function POST(request: NextRequest) {
  let createdUserId: string | null = null;
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
    if (token.length < 32 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
      return NextResponse.json({ ok: false, error: "Enter a valid email and a password with at least 10 characters." }, { status: 400 });
    }

    const admin = createAdminSupabaseAuthClient();
    const { data: invite, error: inviteError } = await admin
      .from("demo_access_invites")
      .select("id,access_days,access_level,expires_at,claimed_at")
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (inviteError || !invite || invite.claimed_at || !Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= Date.now()) {
      return NextResponse.json({ ok: false, error: "This invitation is invalid, expired, or has already been used." }, { status: 410 });
    }

    const demoExpiresAt = new Date(Date.now() + Number(invite.access_days) * 86_400_000).toISOString();
    const accessRole = invite.access_level === "real_estate_operator" ? "demo_operator" : "demo_viewer";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { full_name: fullName || null, access_source: "private_demo_invite" },
      // No demo authority exists until the one-time invitation is claimed.
      app_metadata: { blackspire_role: "client_only" },
    });
    if (createError || !created.user) {
      const existing = createError?.message.toLowerCase().includes("already");
      return NextResponse.json({ ok: false, error: existing ? "That email already has an account. Use the regular sign-in page." : createError?.message ?? "Account creation failed." }, { status: existing ? 409 : 500 });
    }
    createdUserId = created.user.id;

    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin
      .from("demo_access_invites")
      .update({ claimed_at: claimedAt, claimed_by: created.user.id })
      .eq("id", invite.id)
      .is("claimed_at", null)
      .gt("expires_at", claimedAt)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) {
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      return NextResponse.json({ ok: false, error: "This invitation was already used." }, { status: 409 });
    }

    const { error: activationError } = await admin.auth.admin.updateUserById(created.user.id, {
      email_confirm: true,
      app_metadata: { blackspire_role: accessRole, demo_expires_at: demoExpiresAt },
    });
    if (activationError) {
      throw new Error("Demo access could not be activated.");
    }
    // A successful claim and promotion are durable; sign-in failure must not
    // delete the valid account or orphan its consumed invitation.
    createdUserId = null;

    const publicAuth = createPublicSupabaseAuthClient();
    const { data: signedIn, error: signInError } = await publicAuth.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) {
      return NextResponse.json({ ok: true, signedIn: false, message: "Your account is ready. Sign in to open the demonstration." });
    }

    const response = NextResponse.json({ ok: true, signedIn: true, expiresAt: demoExpiresAt });
    applyAuthCookies(response, signedIn.session.access_token, signedIn.session.refresh_token);
    return response;
  } catch (error) {
    if (createdUserId) {
      await createAdminSupabaseAuthClient().auth.admin.deleteUser(createdUserId).catch(() => undefined);
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invitation signup failed." }, { status: 500 });
  }
}
