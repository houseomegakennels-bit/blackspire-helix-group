import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { getAuthenticatedOperator, listAuthUsers } from "@/lib/buyer-engine-auth";

/**
 * Server-side access control for the Blackspire operator surfaces.
 *
 * Role model (v1): the FIRST Supabase auth user is the admin/operator; every
 * later public signup is a beta tester. These helpers enforce that boundary so
 * beta testers cannot view or trigger admin protocols (registry mutations,
 * integrations, analytics, bootstrap) — UI hiding is not enough, since a tester
 * could call the API or page route directly.
 */

export type OperatorRole = "admin" | "beta_tester" | "anonymous";

async function resolveRole(): Promise<{ role: OperatorRole; operatorId: string | null }> {
  const operator = await getAuthenticatedOperator();
  if (!operator?.id) return { role: "anonymous", operatorId: null };
  const users = await listAuthUsers().catch(() => []);
  const isAdmin = users.length > 0 && users[0]?.id === operator.id;
  return { role: isAdmin ? "admin" : "beta_tester", operatorId: operator.id };
}

export async function getOperatorRole(): Promise<OperatorRole> {
  return (await resolveRole()).role;
}

/**
 * For API route handlers. Returns a NextResponse to return early when the caller
 * is not an admin (401 anonymous, 403 signed-in non-admin), or null to proceed.
 */
export async function guardAdminApi(): Promise<NextResponse | null> {
  const { role } = await resolveRole();
  if (role === "anonymous") {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }
  if (role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access is required for this action." }, { status: 403 });
  }
  return null;
}

/** For API route handlers — require any signed-in operator (beta or admin). */
export async function guardSignedInApi(): Promise<NextResponse | null> {
  const { role } = await resolveRole();
  if (role === "anonymous") {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }
  return null;
}

/** For server pages/layouts — redirect non-admins away from admin surfaces. */
export async function requireAdminPage(): Promise<void> {
  const { role } = await resolveRole();
  if (role === "anonymous") redirect("/auth");
  if (role !== "admin") redirect("/workspaces");
}
