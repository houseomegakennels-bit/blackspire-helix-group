import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  buildOpportunitySnapshot,
  normalizeLeadScanInput,
  type LeadScanInput,
} from "@/lib/recon-engine";

export type LeadScanResult = {
  id: string;
  snapshot: string;
  createdAt: string;
};

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing Supabase server credentials for Recon Engine.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Persist a Free Opportunity Scan lead and return the generated snapshot.
 * Runs server-side with the service role (RLS-enabled table, no public access).
 */
export async function createLeadScan(input: Partial<LeadScanInput>): Promise<LeadScanResult> {
  const normalized = normalizeLeadScanInput(input);

  if (!normalized.name) throw new Error("Name is required.");
  if (!normalized.email || !isValidEmail(normalized.email)) {
    throw new Error("A valid email is required.");
  }

  const snapshot = buildOpportunitySnapshot(normalized);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("lead_scans")
    .insert({
      name: normalized.name,
      company_name: normalized.companyName || null,
      email: normalized.email,
      industry: normalized.industry || null,
      services: normalized.services || null,
      county: normalized.county || null,
      state: normalized.state || null,
      report_generated: true,
      report_snapshot: snapshot,
    })
    .select("id,created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    id: data.id as string,
    snapshot,
    createdAt: data.created_at as string,
  };
}

export type ReconCheckoutRecord = {
  email: string | null;
  plan: string | null;
  mode: string | null;
  amountTotal: number | null;
  customerId: string | null;
};

/** Record a completed Recon Engine checkout (from the Stripe webhook). */
export async function recordReconCheckout(record: ReconCheckoutRecord): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("users_profile").insert({
    email: record.email,
    selected_plan: record.plan,
    billing_model: record.mode === "payment" ? "payg" : "subscription",
  });
  if (error) {
    throw new Error(error.message);
  }
}
