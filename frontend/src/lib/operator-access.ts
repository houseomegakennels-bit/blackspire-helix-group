import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { getAuthenticatedOperator, listAuthUsers } from "@/lib/buyer-engine-auth";

/**
 * Server-side access control for the Blackspire operator surfaces.
 *
 * Roles are stored in app_metadata, which can only be written by the server.
 * The first-user admin fallback preserves access for the original operator while
 * existing accounts are migrated to explicit roles.
 */

export type OperatorRole = "admin" | "beta_tester" | "demo_viewer" | "demo_operator" | "client_only" | "anonymous";

export type OperatorContext = {
  role: OperatorRole;
  operatorId: string | null;
  expiresAt: string | null;
  expired: boolean;
};

async function resolveRole(): Promise<OperatorContext> {
  const operator = await getAuthenticatedOperator();
  if (!operator?.id) return { role: "anonymous", operatorId: null, expiresAt: null, expired: false };
  const appRole = operator.app_metadata?.blackspire_role;
  const explicitRole = typeof appRole === "string" && ["admin", "beta_tester", "demo_viewer", "demo_operator", "client_only"].includes(appRole)
    ? appRole as Exclude<OperatorRole, "anonymous">
    : null;
  const expiresAt = typeof operator.app_metadata?.demo_expires_at === "string"
    ? operator.app_metadata.demo_expires_at
    : null;
  const expired = (explicitRole === "demo_viewer" || explicitRole === "demo_operator")
    && Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
  if (explicitRole) return { role: explicitRole, operatorId: operator.id, expiresAt, expired };
  const users = await listAuthUsers().catch(() => []);
  const isAdmin = users.length > 0 && users[0]?.id === operator.id;
  return { role: isAdmin ? "admin" : "client_only", operatorId: operator.id, expiresAt: null, expired: false };
}

export async function getOperatorContext(): Promise<OperatorContext> {
  return resolveRole();
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

/** For API route handlers — require an admitted workspace operator (beta or admin). */
export async function guardSignedInApi(): Promise<NextResponse | null> {
  const { role } = await resolveRole();
  if (role === "anonymous") return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (role !== "admin" && role !== "beta_tester") {
    return NextResponse.json({ ok: false, error: "Operator access is required." }, { status: 403 });
  }
  return null;
}

export async function guardWorkspaceApi(): Promise<NextResponse | null> {
  const context = await resolveRole();
  if (context.role === "anonymous") return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (context.role === "demo_operator" && context.expired) {
    return NextResponse.json({ ok: false, error: "Demonstration access has expired." }, { status: 403 });
  }
  if (context.role !== "admin" && context.role !== "beta_tester" && context.role !== "demo_operator") {
    return NextResponse.json({ ok: false, error: "Workspace access is required." }, { status: 403 });
  }
  return null;
}

/** For server pages/layouts — redirect non-admins away from admin surfaces. */
export async function requireAdminPage(): Promise<void> {
  const { role } = await resolveRole();
  if (role === "anonymous") redirect("/auth");
  if (role !== "admin") redirect("/workspaces");
}

/** For server pages — require an admitted workspace operator; returns the role. */
export async function requireSignedInPage(): Promise<{ role: OperatorRole }> {
  const { role } = await resolveRole();
  if (role === "anonymous") redirect("/auth");
  if (role !== "admin" && role !== "beta_tester") redirect(role === "demo_viewer" ? "/demo" : "/");
  return { role };
}

export async function requireWorkspacePage(): Promise<void> {
  const context = await resolveRole();
  if (context.role === "anonymous") redirect("/auth");
  if (context.role === "demo_operator" && context.expired) redirect("/demo-expired");
  if (context.role !== "admin" && context.role !== "beta_tester" && context.role !== "demo_operator") {
    redirect(context.role === "demo_viewer" ? "/demo" : "/");
  }
}

export async function requireDemoViewerPage(): Promise<OperatorContext> {
  const context = await resolveRole();
  if (context.role === "anonymous") redirect("/demo/login");
  if (context.role === "admin") return context;
  if (context.role !== "demo_viewer" && context.role !== "demo_operator") redirect("/");
  if (context.expired) redirect("/demo-expired");
  return context;
}
