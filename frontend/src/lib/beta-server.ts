import "server-only";

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedOperator, listAuthUsers } from "@/lib/buyer-engine-auth";

/**
 * Beta program server logic: activity logging, soft per-tester rate limits,
 * feedback capture, and the admin beta dashboard snapshot. Admins are exempt
 * from rate limits; everything is keyed to the signed-in operator's id.
 */

function admin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Soft daily caps per beta tester (admins exempt).
const DAILY_LIMITS: Record<string, number> = { sweep: 25, export: 50 };

async function resolveOperator() {
  const operator = await getAuthenticatedOperator();
  if (!operator?.id) return { operatorId: null as string | null, email: null as string | null, isAdmin: false };
  const users = await listAuthUsers().catch(() => []);
  const isAdmin = users.length > 0 && users[0]?.id === operator.id;
  return { operatorId: operator.id, email: operator.email ?? null, isAdmin };
}

export async function logBetaActivity(userId: string | null, action: string, metadata: Record<string, unknown> = {}) {
  const supabase = admin();
  if (!supabase || !userId) return;
  await supabase
    .from("beta_activity")
    .insert({ user_id: userId, action, metadata })
    .then(() => undefined, () => undefined);
}

type GateResult =
  | { response: NextResponse }
  | { operatorId: string; role: "admin" | "beta_tester" };

/**
 * For sweep/export API routes: require sign-in, enforce the soft daily limit for
 * beta testers, log the action. Returns a NextResponse to return early, or the
 * operator context to proceed.
 */
export async function guardBetaAction(action: "sweep" | "export"): Promise<GateResult> {
  const { operatorId, isAdmin } = await resolveOperator();
  if (!operatorId) {
    return { response: NextResponse.json({ ok: false, error: "Please sign in to run this." }, { status: 401 }) };
  }
  if (isAdmin) {
    await logBetaActivity(operatorId, action, {});
    return { operatorId, role: "admin" };
  }

  const supabase = admin();
  if (supabase) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("beta_activity")
      .select("id", { count: "exact", head: true })
      .eq("user_id", operatorId)
      .eq("action", action)
      .gte("created_at", since);
    const limit = DAILY_LIMITS[action] ?? 50;
    if ((count ?? 0) >= limit) {
      return {
        response: NextResponse.json(
          { ok: false, error: `Beta daily limit reached (${limit} ${action}s/day). This resets in 24 hours.` },
          { status: 429 },
        ),
      };
    }
  }
  await logBetaActivity(operatorId, action, {});
  return { operatorId, role: "beta_tester" };
}

export async function submitBetaFeedback(input: { category?: string; message: string; pagePath?: string }) {
  const supabase = admin();
  if (!supabase) return { ok: false as const, error: "Storage is not configured." };
  const { operatorId, email } = await resolveOperator();
  if (!input.message?.trim()) return { ok: false as const, error: "A message is required." };

  const allowed = new Set(["navigation", "bug", "bad_data", "missing_feature", "performance", "other"]);
  const category = allowed.has(input.category ?? "") ? input.category! : "other";

  const { error } = await supabase.from("beta_feedback").insert({
    user_id: operatorId,
    user_email: email,
    category,
    message: input.message.trim().slice(0, 4000),
    page_path: input.pagePath ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export type BetaProgramSnapshot = {
  testers: Array<{ id: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; useCase: string | null }>;
  totals: { testers: number; sweeps: number; exports: number; feedback: number };
  feedback: Array<{ id: string; category: string; message: string; pagePath: string | null; email: string | null; createdAt: string }>;
};

/** Admin beta dashboard data (caller must already be admin-gated). */
export async function getBetaProgramSnapshot(): Promise<BetaProgramSnapshot> {
  const supabase = admin();
  const users = await listAuthUsers().catch(() => []);
  // First user is the admin/operator; everyone else is a beta tester.
  const testerRows = users.slice(1);

  const testers = testerRows.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    createdAt: u.created_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
    useCase: (u.user_metadata?.["beta_use_case"] as string) ?? null,
  }));

  let sweeps = 0;
  let exports = 0;
  let feedbackCount = 0;
  let feedback: BetaProgramSnapshot["feedback"] = [];

  if (supabase) {
    const [sweepRes, exportRes, fbCountRes, fbRes] = await Promise.all([
      supabase.from("beta_activity").select("id", { count: "exact", head: true }).eq("action", "sweep"),
      supabase.from("beta_activity").select("id", { count: "exact", head: true }).eq("action", "export"),
      supabase.from("beta_feedback").select("id", { count: "exact", head: true }),
      supabase.from("beta_feedback").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    sweeps = sweepRes.count ?? 0;
    exports = exportRes.count ?? 0;
    feedbackCount = fbCountRes.count ?? 0;
    feedback = (fbRes.data ?? []).map((row) => ({
      id: String(row.id),
      category: String(row.category),
      message: String(row.message),
      pagePath: (row.page_path as string) ?? null,
      email: (row.user_email as string) ?? null,
      createdAt: String(row.created_at),
    }));
  }

  return {
    testers,
    totals: { testers: testers.length, sweeps, exports, feedback: feedbackCount },
    feedback,
  };
}
