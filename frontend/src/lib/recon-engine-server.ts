import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isAuthenticatedOperatorAdmin } from "@/lib/buyer-engine-auth";
import { analyzeOpportunity } from "@/lib/ai/analyzeOpportunity";
import { fetchSamDescription, fetchSamGovOpportunities } from "@/lib/recon-engine/fetchers/samGovFetcher";
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
      referral_code: normalized.referralCode || null,
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
  const billingModel = record.mode === "payment" ? "payg" : "subscription";

  // Ledger row.
  const { error } = await supabase.from("users_profile").insert({
    email: record.email,
    selected_plan: record.plan,
    billing_model: billingModel,
  });
  if (error) {
    throw new Error(error.message);
  }

  // If the buyer already has a Recon account, attach the plan to it.
  if (record.email) {
    await supabase
      .from("recon_accounts")
      .update({ plan: record.plan, billing_model: billingModel, updated_at: new Date().toISOString() })
      .eq("email", record.email.toLowerCase())
      .then(() => undefined, () => undefined);
  }
}

export type RecentOpportunity = {
  id: string;
  title: string;
  agency: string | null;
  location: string | null;
  deadline: string | null;
  category: string | null;
  originalUrl: string | null;
  summary: string | null;
  bestFitIndustries: string[];
  keywords: string[];
};

type BidAnalysisJoin = {
  summary: string | null;
  best_fit_industries: string[] | null;
  keywords: string[] | null;
};

type BidJoinRow = {
  id: string;
  title: string;
  agency: string | null;
  location: string | null;
  deadline: string | null;
  category: string | null;
  original_url: string | null;
  bid_analysis: BidAnalysisJoin | BidAnalysisJoin[] | null;
};

/** Live opportunities (bids + their AI analysis) for the Recon dashboard. */
export async function listRecentOpportunities(limit = 30): Promise<RecentOpportunity[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bids")
    .select(
      "id,title,agency,location,deadline,category,original_url,bid_analysis(summary,best_fit_industries,keywords)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as BidJoinRow[]).map((row) => {
    const analysis = Array.isArray(row.bid_analysis) ? row.bid_analysis[0] : row.bid_analysis;
    return {
      id: row.id,
      title: row.title,
      agency: row.agency,
      location: row.location,
      deadline: row.deadline,
      category: row.category,
      originalUrl: row.original_url,
      summary: analysis?.summary ?? null,
      bestFitIndustries: analysis?.best_fit_industries ?? [],
      keywords: analysis?.keywords ?? [],
    };
  });
}

function getEnvState(): { enabled: boolean } {
  return { enabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) };
}

export type ReconAdminMetrics = {
  totalLeads: number;
  leadsLast7Days: number;
  totalOpportunities: number;
  analyzedOpportunities: number;
  subscribers: number;
  topIndustries: Array<{ industry: string; count: number }>;
};

/** Admin-only Recon metrics. Throws if the operator is not an admin. */
export async function getReconAdminMetrics(): Promise<ReconAdminMetrics> {
  const isAdmin = await isAuthenticatedOperatorAdmin().catch(() => false);
  if (!isAdmin) throw new Error("Admin access required.");

  const supabase = getSupabaseAdmin();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [leads, recentLeads, opps, analyzed, subs, industryRows] = await Promise.all([
    supabase.from("lead_scans").select("id", { count: "exact", head: true }),
    supabase.from("lead_scans").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase.from("bids").select("id", { count: "exact", head: true }),
    supabase.from("bid_analysis").select("id", { count: "exact", head: true }),
    supabase.from("users_profile").select("id", { count: "exact", head: true }),
    supabase.from("bid_analysis").select("best_fit_industries").limit(500),
  ]);

  const counts = new Map<string, number>();
  for (const row of (industryRows.data ?? []) as Array<{ best_fit_industries: string[] | null }>) {
    for (const ind of row.best_fit_industries ?? []) {
      counts.set(ind, (counts.get(ind) ?? 0) + 1);
    }
  }
  const topIndustries = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([industry, count]) => ({ industry, count }));

  return {
    totalLeads: leads.count ?? 0,
    leadsLast7Days: recentLeads.count ?? 0,
    totalOpportunities: opps.count ?? 0,
    analyzedOpportunities: analyzed.count ?? 0,
    subscribers: subs.count ?? 0,
    topIndustries,
  };
}

export type AlertRecipient = { email: string; isSubscriber: boolean };

/** Distinct alert recipients: free-scan leads + paying subscribers. */
export async function listAlertRecipients(limit = 500): Promise<AlertRecipient[]> {
  const env = getEnvState();
  if (!env.enabled) return [];
  const supabase = getSupabaseAdmin();

  const [{ data: leads }, { data: subs }] = await Promise.all([
    supabase.from("lead_scans").select("email").not("email", "is", null).limit(limit),
    supabase.from("users_profile").select("email").not("email", "is", null).limit(limit),
  ]);

  const subscriberEmails = new Set(
    (subs ?? []).map((r: { email: string | null }) => r.email?.toLowerCase()).filter(Boolean) as string[],
  );
  const byEmail = new Map<string, AlertRecipient>();

  for (const email of subscriberEmails) {
    byEmail.set(email, { email, isSubscriber: true });
  }
  for (const row of leads ?? []) {
    const email = (row as { email: string | null }).email?.toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, { email, isSubscriber: false });
  }

  return [...byEmail.values()].slice(0, limit);
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
  document_url: string | null;
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
    .select("id,title,agency,category,location,description,raw_text,deadline,document_url");

  if (insertErr) {
    summary.errors.push(insertErr.message);
    return summary;
  }

  const rows = (insertedRows ?? []) as InsertedBidRow[];
  summary.inserted = rows.length;

  const analyzeMax = opts?.analyzeMax ?? 10;
  for (const bid of rows.slice(0, analyzeMax)) {
    try {
      // Enrich with the full SAM description for a far better AI analysis.
      const fullDescription = bid.document_url
        ? await fetchSamDescription(bid.document_url).catch(() => null)
        : null;

      const analysis = await analyzeOpportunity({
        title: bid.title,
        agency: bid.agency,
        category: bid.category,
        location: bid.location,
        description: fullDescription || bid.description,
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
