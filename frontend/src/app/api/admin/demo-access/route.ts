import { createHash, randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createAdminSupabaseAuthClient, getAuthenticatedOperator } from "@/lib/buyer-engine-auth";
import { guardAdminApi } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  const denied = await guardAdminApi();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  const requestedDays = Number(body.days || 7);
  const days = Number.isFinite(requestedDays) ? Math.min(30, Math.max(1, Math.round(requestedDays))) : 7;
  const requestedHours = Number(body.linkHours || 48);
  const linkHours = Number.isFinite(requestedHours) ? Math.min(168, Math.max(1, Math.round(requestedHours))) : 48;
  const accessLevel = body.accessLevel === "real_estate_operator" ? "real_estate_operator" : "read_only";
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + linkHours * 3_600_000).toISOString();
  const admin = createAdminSupabaseAuthClient();
  const operator = await getAuthenticatedOperator();
  const { error } = await admin.from("demo_access_invites").insert({
    token_hash: hashToken(token),
    label: label || null,
    access_days: days,
    access_level: accessLevel,
    expires_at: expiresAt,
    created_by: operator?.id ?? null,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message || "Invitation link could not be created." }, { status: 500 });
  }

  const inviteUrl = new URL(`/demo/invite/${token}`, request.nextUrl.origin).toString();
  return NextResponse.json({ ok: true, inviteUrl, linkExpiresAt: expiresAt, accessDays: days, accessLevel });
}
