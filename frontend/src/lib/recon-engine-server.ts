import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { analyzeOpportunity } from "@/lib/ai/analyzeOpportunity";
import { fetchSamGovOpportunities } from "@/lib/recon-engine/fetchers/samGovFetcher";
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

export type IngestSummary = {
  fetched: number;
  inserted: number;
  analyzed: number;
  skipped: number;
  errors: string[];
};

type InsertedBidRow = {
  id: string;
  title: string;
  agency: string | null;
  category: string | null;
  location: string | null;
  description: string | null;
  raw_text: string | null;
  deadline: string | null;
};

/**
 * Phase 3 ingest: fetch SAM.gov opportunities -> dedupe -> insert into `bids`
 * -> AI-analyze the new ones into `bid_analysis`. Returns a run summary.
 */
export async function ingestSamGovOpportunities(opts?: {
  lookbackDays?: number;
  limit?: number;
  analyzeMax?: number;
  state?: string;
}): Promise<IngestSummary> {
  const supabase = getSupabaseAdmin();
  const fetched = await fetchSamGovOpportunities({
    lookbackDays: opts?.lookbackDays,
    limit: opts?.limit,
    state: opts?.state,
  });

  const summary: IngestSummary = {
    fetched: fetched.length,
    inserted: 0,
    analyzed: 0,
    skipped: 0,
    errors: [],
  };
  if (!fetched.length) return summary;

  const urls = fetched.map((o) => o.originalUrl).filter((u): u is string => Boolean(u));
  const { data: existing } = await supabase
    .from("bids")
    .select("original_url")
    .in("original_url", urls);
  const existingSet = new Set(
    (existing ?? []).map((row: { original_url: string | null }) => row.original_url),
  );

  const toInsert = fetched.filter((o) => o.originalUrl && !existingSet.has(o.originalUrl));
  summary.skipped = fetched.length - toInsert.length;
  if (!toInsert.length) return summary;

  const { data: insertedRows, error: insertErr } = await supabase
    .from("bids")
    .insert(
      toInsert.map((o) => ({
        source_name: o.sourceName,
        title: o.title,
        agency: o.agency,
        location: o.location,
        deadline: o.deadline,
        category: o.category,
        description: o.description,
        original_url: o.originalUrl,
        document_url: o.documentUrl,
        raw_text: o.rawText,
      })),
    )
    .select("id,title,agency,category,location,description,raw_text,deadline");

  if (insertErr) {
    summary.errors.push(insertErr.message);
    return summary;
  }

  const rows = (insertedRows ?? []) as InsertedBidRow[];
  summary.inserted = rows.length;

  const analyzeMax = opts?.analyzeMax ?? 10;
  for (const bid of rows.slice(0, analyzeMax)) {
    try {
      const analysis = await analyzeOpportunity({
        title: bid.title,
        agency: bid.agency,
        category: bid.category,
        location: bid.location,
        description: bid.description,
        rawText: bid.raw_text,
        deadline: bid.deadline,
      });
      const { error: aErr } = await supabase.from("bid_analysis").insert({
        bid_id: bid.id,
        summary: analysis.summary,
        requirements: analysis.requirements,
        required_documents: analysis.documentsNeeded,
        estimated_value: analysis.estimatedValue,
        ai_notes: `Type: ${analysis.opportunityType} | Difficulty: ${analysis.estimatedDifficulty} | Next: ${analysis.suggestedNextSteps.join("; ")}`,
        best_fit_industries: analysis.bestFitIndustries,
        keywords: analysis.keywords,
      });
      if (aErr) summary.errors.push(aErr.message);
      else summary.analyzed += 1;
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : "analysis failed");
    }
  }

  return summary;
}
