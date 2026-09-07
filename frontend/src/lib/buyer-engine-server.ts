import "server-only";
import { createBuyerSourceAdapters } from "@/lib/buyer-source-adapters";

import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  countAuthUsers,
  getAuthenticatedOperator,
  hasAdminAuthEnv,
  hasPublicAuthEnv,
  isAuthenticatedOperatorAdmin,
  listAuthUsers,
  type AuthAdminUserRecord,
} from "@/lib/buyer-engine-auth";
import type { OutreachDraftRecord } from "@/lib/outreach-drafts";
import {
  buildCountyCapabilities,
  fallbackCountyCapabilities,
  type CountyCapability,
  type CountySourceRow,
} from "@/lib/buyer-engine-data";
import {
  listSeedBuyerGroups,
  matchBuyerGroupWithRegistry,
  parseBuyerGroupCsv,
  type BuyerGroupMatch,
  type BuyerGroupRegistryEntry,
} from "@/lib/buyer-groups";
import { listSellerLeads } from "@/lib/seller-engine-server";
import type { SellerLeadView } from "@/lib/seller-engine-demo";

export type SearchJobRecord = {
  id: string;
  county: string;
  state: string;
  property_type: string;
  status: "pending" | "processing" | "completed" | "failed";
  date_range_start: string | null;
  date_range_end: string | null;
  total_buyers_found: number | null;
  total_sales_analyzed: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  min_purchases: number | null;
  cash_buyers_only: boolean | null;
  llc_buyers_only: boolean | null;
};

export type BuyerReportRecord = {
  id: string;
  search_job_id: string | null;
  buyer_profile_id: string | null;
  BuyerProfile?:
    | {
        score_breakdown: Record<string, { points?: number; note?: string }> | null;
      }
    | Array<{
        score_breakdown: Record<string, { points?: number; note?: string }> | null;
      }>
    | null;
  buyer_name_snapshot: string | null;
  mailing_address_snapshot: string | null;
  score: number | null;
  purchase_count: number | null;
  total_spend: number | null;
  is_llc: boolean | null;
  is_cash_buyer: boolean | null;
  created_at: string;
};

export type ExportRecord = {
  id: string;
  user_id: string;
  search_job_id: string | null;
  file_name: string;
  storage_path: string;
  row_count: number | null;
  created_at: string;
};

export type BuyerReportPage = {
  reports: BuyerReportRecord[];
  total: number;
  limit: number;
  offset: number;
};

export type BuyerGroupRegistryRow = {
  id: string;
  canonicalName: string;
  groupType: "hedge_fund_group";
  aliases: string[];
  states: string[];
  counties: string[];
  website: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BuyerReverseSearchCriteria = {
  buyerName?: string;
  buyerGroup?: string;
  targetCounty?: string;
  targetCity?: string;
  targetZipCodes?: string[];
  propertyType?: string;
  minBeds?: number | null;
  maxPrice?: number | null;
  minimumArvSpread?: number | null;
  buyBoxNotes?: string;
  buyerProfileType?: "cash_buyer" | "landlord" | "flipper" | "hedge_fund" | "unknown";
  preferredRadius?: number | null;
  activeOnly?: boolean;
};

export type BuyerReverseSearchMatch = {
  id: string;
  sourceType: "seller_lead" | "deal";
  sourceId: string;
  propertyAddress: string;
  city: string;
  county: string;
  zip: string;
  estimatedArv: number;
  estimatedMao: number;
  motivationScore: number;
  matchScore: number;
  matchReasons: string[];
  recommendedAction: string;
  link: string;
};

export type BuyerReverseSearchResult = {
  criteria: BuyerReverseSearchCriteria;
  matches: BuyerReverseSearchMatch[];
  generatedAt: string;
};

type CreateSearchJobInput = {
  title: string;
  state: string;
  county: string;
  propertyType: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  minPurchases: number;
  notes?: string;
};

type CreateExportInput = {
  searchJobId?: string | null;
  fileName: string;
  rowCount: number;
  storagePath?: string;
};

type CountyDataSourceRecord = {
  county: string;
  state: string;
  source_type: string;
  source_url: string | null;
  active: boolean;
  notes: string | null;
};

type EnvState = {
  enabled: boolean;
  missing: string[];
};

type ReverseDealJoinRow = {
  id: string;
  seller_lead_id: string | null;
  property_address: string | null;
  county: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  status: string | null;
  motivation_score: number | null;
  property_type: string | null;
  estimated_equity: number | string | null;
  recommended_next_action: string | null;
  deal_analysis:
    | {
        estimated_arv: number | string | null;
        maximum_allowable_offer: number | string | null;
        purchase_price_target: number | string | null;
        wholesale_spread: number | string | null;
      }
    | Array<{
        estimated_arv: number | string | null;
        maximum_allowable_offer: number | string | null;
        purchase_price_target: number | string | null;
        wholesale_spread: number | string | null;
      }>
    | null;
  buyer_matches:
    | {
        buyer_score: number | null;
        exit_strategy: string | null;
        investor_type_recommendation: string | null;
      }
    | Array<{
        buyer_score: number | null;
        exit_strategy: string | null;
        investor_type_recommendation: string | null;
      }>
    | null;
};

export type BuyerEngineRealtimeClientEnv = {
  enabled: boolean;
  url: string | null;
  anonKey: string | null;
};

export type DashboardSnapshot = {
  operatorId: string | null;
  searchJobCount: number;
  completedJobCount: number;
  processingJobCount: number;
  failedJobCount: number;
  buyerReportCount: number;
  exportCount: number;
  outreachDraftCount: number;
};

export type OperatorShellStatus = {
  authConfigured: boolean;
  signedIn: boolean;
  bootstrapRequired: boolean;
  usingFallback: boolean;
  requiresAuth: boolean;
  isAdmin: boolean;
  operatorId: string | null;
  operatorEmail: string | null;
};

export type BetaTesterSnapshot = {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  fullName: string | null;
  company: string | null;
  useCase: string | null;
  accessSource: string | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalBuyersFound: number;
  totalSalesAnalyzed: number;
  latestCounty: string | null;
  latestJobCreatedAt: string | null;
};

export type BetaTesterAnalytics = {
  totalTesters: number;
  activeLast7Days: number;
  signedInLast7Days: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageJobsPerTester: number;
  topCounties: Array<{ county: string; jobs: number }>;
  topCompanies: Array<{ company: string; testers: number }>;
  topUseCases: Array<{ useCase: string; testers: number }>;
};

const OUTREACH_DRAFT_BUCKET = "blackspire-outreach-drafts";

function getEnvState(): EnvState {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const missing = required.filter((key) => !process.env[key]);

  return {
    enabled: missing.length === 0,
    missing,
  };
}

function getSupabaseAdmin(): SupabaseClient {
  const env = getEnvState();
  if (!env.enabled) {
    throw new Error(`Missing Supabase env: ${env.missing.join(", ")}`);
  }

  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getDefaultUserId() {
  return process.env.BLACKSPIRE_DEFAULT_USER_ID?.trim() || null;
}

function isMissingRelationError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("could not find the table");
}

async function getOperatorScope(mode: "read" | "write") {
  const [operator, authUserCount] = await Promise.all([
    getAuthenticatedOperator(),
    countAuthUsers().catch(() => 0),
  ]);

  if (operator?.id) {
    return {
      operatorId: operator.id,
      bootstrapComplete: authUserCount > 0,
      requiresAuth: false,
    };
  }

  if (authUserCount > 0) {
    if (mode === "write") {
      throw new Error("Sign in required. Operator accounts already exist for this project. Use /auth before creating or changing data.");
    }

    return {
      operatorId: null,
      bootstrapComplete: true,
      requiresAuth: true,
    };
  }

  // No operator accounts exist yet. The default-user bridge is deprecated and
  // optional: use it only if still configured, otherwise require bootstrap via
  // /auth so there is no hard env dependency.
  const fallbackId = getDefaultUserId();
  if (fallbackId) {
    return {
      operatorId: fallbackId,
      bootstrapComplete: false,
      requiresAuth: false,
    };
  }

  if (mode === "write") {
    throw new Error("No operator account exists yet. Create the first operator at /auth before creating data.");
  }

  return {
    operatorId: null,
    bootstrapComplete: false,
    requiresAuth: true,
  };
}

function toIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asSingle<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function getBuyerEngineEnvStatus() {
  return {
    ...getEnvState(),
    hasDefaultUserId: Boolean(getDefaultUserId()),
  };
}

export function getBuyerEngineRealtimeClientEnv(): BuyerEngineRealtimeClientEnv {
  return {
    enabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    url: process.env.SUPABASE_URL?.trim() || null,
    anonKey: process.env.SUPABASE_ANON_KEY?.trim() || null,
  };
}

export async function getOperatorShellStatus(): Promise<OperatorShellStatus> {
  const [operator, authUserCount, isAdmin] = await Promise.all([
    getAuthenticatedOperator(),
    countAuthUsers().catch(() => 0),
    isAuthenticatedOperatorAdmin().catch(() => false),
  ]);

  if (operator?.id) {
    return {
      authConfigured: hasPublicAuthEnv() && hasAdminAuthEnv(),
      signedIn: true,
      bootstrapRequired: false,
      usingFallback: false,
      requiresAuth: false,
      isAdmin,
      operatorId: operator.id,
      operatorEmail: operator.email ?? null,
    };
  }

  if (authUserCount > 0) {
    return {
      authConfigured: hasPublicAuthEnv() && hasAdminAuthEnv(),
      signedIn: false,
      bootstrapRequired: false,
      usingFallback: false,
      requiresAuth: true,
      isAdmin: false,
      operatorId: null,
      operatorEmail: null,
    };
  }

  const fallbackUserId = getDefaultUserId();
  return {
    authConfigured: hasPublicAuthEnv() && hasAdminAuthEnv(),
    signedIn: false,
    bootstrapRequired: true,
    usingFallback: Boolean(fallbackUserId),
    requiresAuth: false,
    isAdmin: false,
    operatorId: fallbackUserId,
    operatorEmail: null,
  };
}

function pickUserMetadataValue(user: AuthAdminUserRecord, key: string) {
  const value = user.user_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarizeTopValues(entries: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export async function getBetaTesterSnapshot() {
  const env = getEnvState();
  if (!env.enabled) {
    return {
      testers: [] as BetaTesterSnapshot[],
      analytics: {
        totalTesters: 0,
        activeLast7Days: 0,
        signedInLast7Days: 0,
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        averageJobsPerTester: 0,
        topCounties: [],
        topCompanies: [],
        topUseCases: [],
      } satisfies BetaTesterAnalytics,
    };
  }

  const [isAdmin, users] = await Promise.all([
    isAuthenticatedOperatorAdmin().catch(() => false),
    listAuthUsers(),
  ]);

  if (!isAdmin) {
    throw new Error("Admin access required.");
  }

  const adminUserId = users[0]?.id ?? null;
  const testers = users.filter((user) => user.id !== adminUserId);
  if (testers.length === 0) {
    return {
      testers: [] as BetaTesterSnapshot[],
      analytics: {
        totalTesters: 0,
        activeLast7Days: 0,
        signedInLast7Days: 0,
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        averageJobsPerTester: 0,
        topCounties: [],
        topCompanies: [],
        topUseCases: [],
      } satisfies BetaTesterAnalytics,
    };
  }

  const supabase = getSupabaseAdmin();
  const testerIds = testers.map((tester) => tester.id);
  const { data: jobs, error } = await supabase
    .from("SearchJob")
    .select("id,user_id,county,status,total_buyers_found,total_sales_analyzed,created_at")
    .in("user_id", testerIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const jobsByUser = new Map<string, Array<{
    county: string;
    status: SearchJobRecord["status"];
    total_buyers_found: number | null;
    total_sales_analyzed: number | null;
    created_at: string;
  }>>();

  for (const job of jobs ?? []) {
    const current = jobsByUser.get(job.user_id) ?? [];
    current.push(job);
    jobsByUser.set(job.user_id, current);
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const snapshots = testers.map((user) => {
    const userJobs = jobsByUser.get(user.id) ?? [];
    const latestJob = userJobs[0] ?? null;

    return {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      fullName: pickUserMetadataValue(user, "full_name"),
      company: pickUserMetadataValue(user, "company"),
      useCase: pickUserMetadataValue(user, "beta_use_case"),
      accessSource: pickUserMetadataValue(user, "access_source"),
      totalJobs: userJobs.length,
      completedJobs: userJobs.filter((job) => job.status === "completed").length,
      failedJobs: userJobs.filter((job) => job.status === "failed").length,
      totalBuyersFound: userJobs.reduce((sum, job) => sum + Number(job.total_buyers_found ?? 0), 0),
      totalSalesAnalyzed: userJobs.reduce((sum, job) => sum + Number(job.total_sales_analyzed ?? 0), 0),
      latestCounty: latestJob?.county ?? null,
      latestJobCreatedAt: latestJob?.created_at ?? null,
    } satisfies BetaTesterSnapshot;
  });

  const analytics = {
    totalTesters: snapshots.length,
    activeLast7Days: snapshots.filter((tester) => {
      const ts = Date.parse(tester.latestJobCreatedAt ?? "");
      return Number.isFinite(ts) && ts >= sevenDaysAgo;
    }).length,
    signedInLast7Days: snapshots.filter((tester) => {
      const ts = Date.parse(tester.lastSignInAt ?? "");
      return Number.isFinite(ts) && ts >= sevenDaysAgo;
    }).length,
    totalJobs: snapshots.reduce((sum, tester) => sum + tester.totalJobs, 0),
    completedJobs: snapshots.reduce((sum, tester) => sum + tester.completedJobs, 0),
    failedJobs: snapshots.reduce((sum, tester) => sum + tester.failedJobs, 0),
    averageJobsPerTester: snapshots.length
      ? Math.round((snapshots.reduce((sum, tester) => sum + tester.totalJobs, 0) / snapshots.length) * 10) / 10
      : 0,
    topCounties: summarizeTopValues(
      (jobs ?? []).map((job) => job.county).filter(Boolean),
      6,
    ).map(({ value, count }) => ({ county: value, jobs: count })),
    topCompanies: summarizeTopValues(
      snapshots.map((tester) => tester.company).filter((value): value is string => Boolean(value)),
      6,
    ).map(({ value, count }) => ({ company: value, testers: count })),
    topUseCases: summarizeTopValues(
      snapshots.map((tester) => tester.useCase).filter((value): value is string => Boolean(value)),
      6,
    ).map(({ value, count }) => ({ useCase: value, testers: count })),
  } satisfies BetaTesterAnalytics;

  return { testers: snapshots, analytics };
}

export async function listSearchJobs(limit = 12): Promise<SearchJobRecord[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  const scope = await getOperatorScope("read");
  if (scope.requiresAuth || !scope.operatorId) return [];

  let query = supabase
    .from("SearchJob")
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  query = query.eq("user_id", scope.operatorId);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SearchJobRecord[];
}

export async function getSearchJobById(searchJobId: string): Promise<SearchJobRecord | null> {
  const env = getEnvState();
  if (!env.enabled) return null;

  const supabase = getSupabaseAdmin();
  const scope = await getOperatorScope("read");
  if (scope.requiresAuth || !scope.operatorId) return null;
  let query = supabase
    .from("SearchJob")
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .eq("id", searchJobId)
    .limit(1);

  query = query.eq("user_id", scope.operatorId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return (data as SearchJobRecord | null) ?? null;
}

export async function listSearchJobsByIds(searchJobIds: string[]): Promise<SearchJobRecord[]> {
  const env = getEnvState();
  if (!env.enabled || searchJobIds.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const scope = await getOperatorScope("read");
  if (scope.requiresAuth || !scope.operatorId) return [];
  const uniqueIds = [...new Set(searchJobIds.filter(Boolean))];
  let query = supabase
    .from("SearchJob")
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .in("id", uniqueIds);

  query = query.eq("user_id", scope.operatorId);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SearchJobRecord[];
}

export async function createSearchJob(input: CreateSearchJobInput) {
  const env = getEnvState();
  if (!env.enabled) {
    throw new Error(`Missing Supabase env: ${env.missing.join(", ")}`);
  }

  const scope = await getOperatorScope("write");
  const userId = scope.operatorId!;

  const supabase = getSupabaseAdmin();
  const payload = {
    user_id: userId,
    state: input.state.trim().toUpperCase(),
    county: input.county.trim(),
    property_type: input.propertyType,
    date_range_start: toIsoDate(input.dateRangeStart),
    date_range_end: toIsoDate(input.dateRangeEnd),
    min_purchases: input.minPurchases,
    cash_buyers_only: false,
    llc_buyers_only: false,
    status: "pending",
  };

  const { data, error } = await supabase
    .from("SearchJob")
    .insert(payload)
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SearchJobRecord;
}

export async function listBuyerReports(searchJobId: string, limit = 8): Promise<BuyerReportRecord[]> {
  const env = getEnvState();
  if (!env.enabled) return [];
  const operator = await getAuthenticatedOperator();
  if (!operator?.id) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("BuyerReport")
    .select("id,search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer,created_at,BuyerProfile(score_breakdown),SearchJob!inner(user_id)")
    .eq("SearchJob.user_id", operator.id)
    .eq("search_job_id", searchJobId)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as BuyerReportRecord[];
}

export async function listAllBuyerReports({
  limit = 20,
  offset = 0,
  searchJobId,
}: {
  limit?: number;
  offset?: number;
  searchJobId?: string;
} = {}): Promise<BuyerReportPage> {
  const env = getEnvState();
  const operator = env.enabled ? await getAuthenticatedOperator() : null;
  if (!operator?.id) {
    return {
      reports: [],
      total: 0,
      limit,
      offset,
    };
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("BuyerReport")
    .select(
      "id,search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer,created_at,BuyerProfile(score_breakdown),SearchJob!inner(user_id)",
      { count: "exact" },
    )
    .eq("SearchJob.user_id", operator.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + Math.max(limit - 1, 0));

  if (searchJobId) {
    query = query.eq("search_job_id", searchJobId);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    reports: (data ?? []) as BuyerReportRecord[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function listExports({
  limit = 12,
  searchJobId,
}: {
  limit?: number;
  searchJobId?: string;
} = {}): Promise<ExportRecord[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  const scope = await getOperatorScope("read");
  if (scope.requiresAuth || !scope.operatorId) return [];
  let query = supabase
    .from("exports")
    .select("id,user_id,search_job_id,file_name,storage_path,row_count,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  query = query.eq("user_id", scope.operatorId);

  if (searchJobId) {
    query = query.eq("search_job_id", searchJobId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ExportRecord[];
}

export async function createExportRecord(input: CreateExportInput): Promise<ExportRecord> {
  const env = getEnvState();
  if (!env.enabled) {
    throw new Error(`Missing Supabase env: ${env.missing.join(", ")}`);
  }

  const scope = await getOperatorScope("write");
  const userId = scope.operatorId!;

  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new Error("Export file name is required.");
  }

  const storagePath =
    input.storagePath?.trim() ||
    `client-downloads/${new Date().toISOString().slice(0, 10)}/${fileName}`;

  const supabase = getSupabaseAdmin();
  const payload = {
    user_id: userId,
    search_job_id: input.searchJobId ?? null,
    file_name: fileName,
    storage_path: storagePath,
    row_count: input.rowCount,
  };

  const { data, error } = await supabase
    .from("exports")
    .insert(payload)
    .select("id,user_id,search_job_id,file_name,storage_path,row_count,created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ExportRecord;
}

export async function listCountySourceRows(includeInactive = true): Promise<CountySourceRow[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("CountyDataSource")
    .select("county,state,source_type,active,notes")
    .order("county", { ascending: true });

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CountySourceRow[];
}

export type AdminCountySourceRow = {
  id: string;
  county: string;
  state: string;
  source_type: string;
  source_url: string | null;
  active: boolean;
  notes: string | null;
  created_at: string | null;
};

export async function listAdminCountySourceRows(): Promise<AdminCountySourceRow[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("CountyDataSource")
    .select("id,county,state,source_type,source_url,active,notes,created_at")
    .order("county", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AdminCountySourceRow[];
}

export async function toggleCountySourceActive(id: string, active: boolean): Promise<void> {
  const env = getEnvState();
  if (!env.enabled) throw new Error("Supabase env not configured.");

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("CountyDataSource")
    .update({ active })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

type BuyerGroupRegistryDbRow = {
  id: string;
  canonical_name: string;
  group_type: string;
  aliases: unknown;
  states: unknown;
  counties: unknown;
  website: string | null;
  notes: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function mapBuyerGroupRow(row: BuyerGroupRegistryDbRow): BuyerGroupRegistryRow {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    groupType: "hedge_fund_group",
    aliases: asStringArray(row.aliases),
    states: asStringArray(row.states),
    counties: asStringArray(row.counties),
    website: row.website,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function seedBuyerGroupRows(): BuyerGroupRegistryRow[] {
  return listSeedBuyerGroups().map((group, index) => ({
    id: `seed-${index + 1}`,
    canonicalName: group.canonicalName,
    groupType: group.groupType,
    aliases: group.aliases,
    states: group.states ?? [],
    counties: group.counties ?? [],
    website: group.website ?? null,
    notes: group.notes ?? "Seeded registry fallback entry.",
    active: group.active ?? true,
    createdAt: null,
    updatedAt: null,
  }));
}

function buildBuyerGroupRegistryUpsertPayload(entries: BuyerGroupRegistryEntry[]) {
  return entries.map((row) => ({
    canonical_name: row.canonicalName,
    group_type: row.groupType,
    aliases: row.aliases,
    states: row.states ?? [],
    counties: row.counties ?? [],
    website: row.website ?? null,
    notes: row.notes ?? null,
    active: row.active ?? true,
    updated_at: new Date().toISOString(),
  }));
}

async function ensureBuyerGroupRegistrySeeded(
  supabase: SupabaseClient,
  existingRows: BuyerGroupRegistryDbRow[],
): Promise<BuyerGroupRegistryDbRow[]> {
  if (existingRows.length) {
    return existingRows;
  }

  const payload = buildBuyerGroupRegistryUpsertPayload(listSeedBuyerGroups());
  const { error: upsertError } = await supabase
    .from("buyer_group_registry")
    .upsert(payload, { onConflict: "canonical_name" });

  if (upsertError) {
    if (isMissingRelationError(upsertError.message)) {
      throw new Error("buyer_group_registry table is missing. Apply migration 004_buyer_group_registry.sql first.");
    }
    throw new Error(upsertError.message);
  }

  const { data: seededData, error: seededError } = await supabase
    .from("buyer_group_registry")
    .select("id,canonical_name,group_type,aliases,states,counties,website,notes,active,created_at,updated_at")
    .order("canonical_name", { ascending: true });

  if (seededError) {
    throw new Error(seededError.message);
  }

  return (seededData ?? []) as BuyerGroupRegistryDbRow[];
}

export async function listBuyerGroupRegistry(includeInactive = true, { readOnly = false } = {}): Promise<BuyerGroupRegistryRow[]> {
  const env = getEnvState();
  if (!env.enabled) {
    if (readOnly) throw new Error("Buyer registry unavailable");
    const seeds = seedBuyerGroupRows();
    return includeInactive ? seeds : seeds.filter((row) => row.active);
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("buyer_group_registry")
    .select("id,canonical_name,group_type,aliases,states,counties,website,notes,active,created_at,updated_at")
    .order("canonical_name", { ascending: true });

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) {
    if (!readOnly && isMissingRelationError(error.message)) {
      const seeds = seedBuyerGroupRows();
      return includeInactive ? seeds : seeds.filter((row) => row.active);
    }
    throw new Error(error.message);
  }

  const resolvedRows = readOnly ? (data ?? []) as BuyerGroupRegistryDbRow[] : await ensureBuyerGroupRegistrySeeded(
    supabase,
    (data ?? []) as BuyerGroupRegistryDbRow[],
  );

  const mappedRows = resolvedRows.map(mapBuyerGroupRow);
  return includeInactive ? mappedRows : mappedRows.filter((row) => row.active);
}

export async function importBuyerGroupRegistryCsv(csv: string) {
  const env = getEnvState();
  if (!env.enabled) {
    throw new Error(`Missing Supabase env: ${env.missing.join(", ")}`);
  }

  const scope = await getOperatorScope("write");
  if (!scope.operatorId) {
    throw new Error("Operator identity is required for buyer group imports.");
  }

  const parsed = parseBuyerGroupCsv(csv);
  if (!parsed.length) {
    throw new Error("The import did not contain any valid buyer group rows.");
  }

  const supabase = getSupabaseAdmin();
  const payload = buildBuyerGroupRegistryUpsertPayload(parsed);

  const { error } = await supabase
    .from("buyer_group_registry")
    .upsert(payload, { onConflict: "canonical_name" });

  if (error) {
    if (isMissingRelationError(error.message)) {
      throw new Error("buyer_group_registry table is missing. Apply migration 004_buyer_group_registry.sql first.");
    }
    throw new Error(error.message);
  }

  return {
    imported: payload.length,
    total: parsed.length,
  };
}

export async function syncDefaultBuyerGroups() {
  const env = getEnvState();
  if (!env.enabled) {
    throw new Error(`Missing Supabase env: ${env.missing.join(", ")}`);
  }

  const scope = await getOperatorScope("write");
  if (!scope.operatorId) {
    throw new Error("Operator identity is required for buyer group sync.");
  }

  const supabase = getSupabaseAdmin();
  const payload = buildBuyerGroupRegistryUpsertPayload(listSeedBuyerGroups());

  const { error } = await supabase
    .from("buyer_group_registry")
    .upsert(payload, { onConflict: "canonical_name" });

  if (error) {
    if (isMissingRelationError(error.message)) {
      throw new Error("buyer_group_registry table is missing. Apply migration 004_buyer_group_registry.sql first.");
    }
    throw new Error(error.message);
  }

  return {
    synced: payload.length,
  };
}

export async function toggleBuyerGroupActive(id: string, active: boolean): Promise<void> {
  const env = getEnvState();
  if (!env.enabled) throw new Error("Supabase env not configured.");

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("buyer_group_registry")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (isMissingRelationError(error.message)) {
      throw new Error("buyer_group_registry table is missing. Apply migration 004_buyer_group_registry.sql first.");
    }
    throw new Error(error.message);
  }
}

export async function getBuyerGroupMatchForName(buyerName: string | null | undefined): Promise<BuyerGroupMatch | null> {
  const registryRows = await listBuyerGroupRegistry(false);
  const registry: BuyerGroupRegistryEntry[] = registryRows.map((row) => ({
    canonicalName: row.canonicalName,
    groupType: row.groupType,
    aliases: row.aliases,
    states: row.states,
    counties: row.counties,
    website: row.website,
    notes: row.notes,
    active: row.active,
  }));

  return matchBuyerGroupWithRegistry(buyerName, registry);
}

// ---------------------------------------------------------------------------
// Canonical property -> buyers matcher (the single source of truth)
// ---------------------------------------------------------------------------
// Queries the real BuyerProfile universe (13k+ buyers with purchase history) plus
// the institutional buyer_group_registry, scores fit for a given property, and
// explains every match. Harvester, Deal Engine, and Sentinel all call this — no
// engine re-implements buyer logic.

export type BuyerForPropertyInput = {
  county?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
  propertyType?: string | null;
  askingPrice?: number | null;
  beds?: number | null;
  baths?: number | null;
  limit?: number;
};

export type BuyerForPropertyMatch = {
  buyerId: string;
  buyerName: string;
  buyerType: "cash_buyer" | "landlord" | "flipper" | "institutional" | "investor";
  source: "buyer_profile" | "institutional_registry";
  matchScore: number;
  confidence: number;
  reasons: string[];
  purchaseCount: number | null;
  lastPurchase: string | null;
  recommendedAction: string;
};

export type BuyerForPropertyResult = {
  matches: BuyerForPropertyMatch[];
  buyerCount: number;
  demandScore: number;
  assignmentPotential: "high" | "medium" | "low";
  county: string | null;
};

function normalizeCountyName(county?: string | null): string {
  return (county ?? "")
    .replace(/county/gi, "")
    .trim()
    .toLowerCase();
}

// NC city -> county for the common cities (so a property with a city but no
// county — e.g. "Durham" or "Greensboro" — still matches buyers).
const NC_CITY_TO_COUNTY: Record<string, string> = {
  charlotte: "mecklenburg", greensboro: "guilford", winstonsalem: "forsyth",
  raleigh: "wake", durham: "durham", fayetteville: "cumberland", cary: "wake",
  wilmington: "newhanover", highpoint: "guilford", concord: "cabarrus",
  gastonia: "gaston", asheville: "buncombe", greenville: "pitt",
  jacksonville: "onslow", chapelhill: "orange", burlington: "alamance",
  huntersville: "mecklenburg", rockymount: "nash", kannapolis: "cabarrus",
  statesville: "iredell", monroe: "union", apex: "wake", wakeforest: "wake",
  hickory: "catawba", goldsboro: "wayne", mooresville: "iredell",
  newbern: "craven", salisbury: "rowan", sanford: "lee", garner: "wake",
  thomasville: "davidson", lexington: "davidson", kernersville: "forsyth",
};

const UNKNOWN_COUNTY = new Set(["", "unknown", "unresolved", "n/a", "na", "none"]);

/** Infer an NC county from a city name (Title Case), or null if unknown. */
export function inferNcCountyFromCity(city?: string | null): string | null {
  const cityKey = (city ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!cityKey) return null;
  const mapped = NC_CITY_TO_COUNTY[cityKey];
  if (mapped) return mapped.replace(/\b\w/g, (m) => m.toUpperCase());
  return null;
}

/** Resolve a usable county for buyer matching, inferring from city when needed. */
function resolveBuyerCounty(county?: string | null, city?: string | null): { core: string; display: string | null } {
  const core = normalizeCountyName(county);
  if (core && !UNKNOWN_COUNTY.has(core)) {
    return { core, display: county ?? null };
  }
  const cityKey = (city ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (NC_CITY_TO_COUNTY[cityKey]) {
    const mapped = NC_CITY_TO_COUNTY[cityKey];
    return { core: mapped, display: mapped.replace(/\b\w/g, (m) => m.toUpperCase()) };
  }
  // Last resort: many NC cities share their county's name (Durham, Orange, etc).
  const cityCore = normalizeCountyName(city);
  if (cityCore && !UNKNOWN_COUNTY.has(cityCore)) {
    return { core: cityCore, display: city ?? null };
  }
  return { core: "", display: null };
}

function resolvePropertyTypeBucket(input: BuyerForPropertyInput): "land" | "residential" {
  const text = `${input.propertyType ?? ""}`.toLowerCase();
  if (/land|lot|acre|vacant/.test(text)) return "land";
  if (input.beds || input.baths) return "residential";
  return "residential";
}

function monthsSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.4);
}

export type BuyerProfileRow = {
  id: string;
  buyer_name: string | null;
  county: string | null;
  state: string | null;
  is_llc: boolean | null;
  is_cash_buyer: boolean | null;
  purchase_count: number | null;
  total_spend: number | null;
  last_purchase_date: string | null;
  property_types: string[] | null;
  score: number | null;
};

export type BuyerCapabilityProfileInput = {
  buyerName?: string | null;
  state?: string | null;
  county?: string | null;
  propertyType?: string | null;
  cashBuyer?: boolean | null;
  llcBuyer?: boolean | null;
  limit: number;
};

/** Bounded, persisted BuyerProfile read for the internal Hermes capability. */
export async function listBuyerProfilesForCapability(input: BuyerCapabilityProfileInput): Promise<BuyerProfileRow[]> {
  const env = getEnvState();
  if (!env.enabled) throw new Error("Buyer profiles unavailable");

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("BuyerProfile")
    .select("id,buyer_name,county,state,is_llc,is_cash_buyer,purchase_count,total_spend,last_purchase_date,property_types,score")
    .order("purchase_count", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(input.limit);
  if (input.buyerName) query = query.ilike("buyer_name", `%${input.buyerName.replace(/[\\%_]/g, "\\$&")}%`);
  if (input.county) query = query.ilike("county", `%${normalizeCountyName(input.county)}%`);
  if (input.state) query = query.ilike("state", input.state);
  if (input.cashBuyer !== null && input.cashBuyer !== undefined) query = query.eq("is_cash_buyer", input.cashBuyer);
  if (input.llcBuyer !== null && input.llcBuyer !== undefined) query = query.eq("is_llc", input.llcBuyer);
  if (input.propertyType) query = query.contains("property_types", [input.propertyType.toLowerCase()]);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as BuyerProfileRow[];
}

function classifyBuyerType(row: BuyerProfileRow): BuyerForPropertyMatch["buyerType"] {
  const count = row.purchase_count ?? 0;
  if (row.is_llc && count >= 20) return "institutional";
  if (row.is_llc) return "landlord";
  if (count >= 8) return "flipper";
  if (row.is_cash_buyer) return "cash_buyer";
  return "investor";
}

function scoreBuyerProfile(row: BuyerProfileRow, bucket: "land" | "residential") {
  const reasons: string[] = [];
  let score = 24;
  const countyLabel = row.county ?? "this county";

  reasons.push(`Active buyer in ${countyLabel}.`);
  score += 30; // county-scoped query guarantees a geographic match

  const months = monthsSince(row.last_purchase_date);
  if (months !== null && months <= 6) {
    score += 20;
    reasons.push(`Bought within the last ${Math.max(1, Math.round(months))} month(s).`);
  } else if (months !== null && months <= 12) {
    score += 12;
    reasons.push("Purchased in the past year.");
  } else if (months !== null && months <= 24) {
    score += 5;
    reasons.push("Purchased in the past two years.");
  }

  const count = row.purchase_count ?? 0;
  if (count >= 20) {
    score += 15;
    reasons.push(`${count} recorded purchases — high-volume buyer.`);
  } else if (count >= 8) {
    score += 10;
    reasons.push(`${count} recorded purchases.`);
  } else if (count >= 3) {
    score += 6;
    reasons.push(`${count} recorded purchases.`);
  }

  const types = (row.property_types ?? []).map((value) => value.toLowerCase());
  if (types.includes(bucket)) {
    score += 10;
    reasons.push(`Buys ${bucket} inventory.`);
  }
  if (row.is_llc) {
    score += 5;
    reasons.push("Portfolio / LLC buyer.");
  }
  if (row.is_cash_buyer) {
    score += 5;
    reasons.push("Verified cash buyer.");
  }

  return { score: Math.min(99, score), reasons };
}

export async function matchBuyersForProperty(input: BuyerForPropertyInput, { readOnly = false } = {}): Promise<BuyerForPropertyResult> {
  const supabase = getSupabaseAdmin();
  const { core: countyCore, display: countyDisplay } = resolveBuyerCounty(input.county, input.city);
  const bucket = resolvePropertyTypeBucket(input);
  const limit = input.limit ?? 10;

  if (!countyCore) {
    return { matches: [], buyerCount: 0, demandScore: 0, assignmentPotential: "low", county: input.county ?? null };
  }

  // Real buyers from the BuyerProfile universe (the source of truth). Fetch the
  // top-200 by volume for scoring, and a true county-wide count for validation.
  const [{ data: profileRows, error: profileError }, { count: countyBuyerCount, error: countError }] = await Promise.all([
    supabase
      .from("BuyerProfile")
      .select("id, buyer_name, county, state, is_llc, is_cash_buyer, purchase_count, total_spend, last_purchase_date, property_types, score")
      .ilike("county", `%${countyCore}%`)
      .order("purchase_count", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("BuyerProfile")
      .select("id", { count: "exact", head: true })
      .ilike("county", `%${countyCore}%`),
  ]);
  if (readOnly && (profileError || countError)) throw new Error("Buyer matches unavailable");

  const rows = (profileRows ?? []) as BuyerProfileRow[];
  const buyerCount = countyBuyerCount ?? rows.length;

  const profileMatches: BuyerForPropertyMatch[] = rows.map((row) => {
    const { score, reasons } = scoreBuyerProfile(row, bucket);
    const buyerType = classifyBuyerType(row);
    return {
      buyerId: row.id,
      buyerName: row.buyer_name ?? "Unnamed buyer",
      buyerType,
      source: "buyer_profile",
      matchScore: score,
      confidence: Math.min(99, Math.round((row.score ?? score) * 0.6 + score * 0.4)),
      reasons,
      purchaseCount: row.purchase_count ?? null,
      lastPurchase: row.last_purchase_date ?? null,
      recommendedAction:
        score >= 70
          ? "Send this opportunity to the buyer and request proof of funds."
          : "Hold as a secondary buyer lane until the box tightens.",
    };
  });

  // Institutional groups remain a secondary lane (no longer the only source).
  const registry = readOnly
    ? await listBuyerGroupRegistry(false, { readOnly: true })
    : await listBuyerGroupRegistry(false).catch(() => []);
  const institutionalMatches: BuyerForPropertyMatch[] = registry
    .filter((group) => (group.counties ?? []).some((c) => normalizeCountyName(c) === countyCore))
    .map((group) => ({
      buyerId: group.id,
      buyerName: group.canonicalName,
      buyerType: "institutional" as const,
      source: "institutional_registry" as const,
      matchScore: 62,
      confidence: 60,
      reasons: [`Institutional buyer group active in ${input.county}.`, group.groupType ? `Profile: ${group.groupType}.` : ""].filter(Boolean),
      purchaseCount: null,
      lastPurchase: null,
      recommendedAction: "Route through the institutional disposition lane.",
    }));

  const matches = [...profileMatches, ...institutionalMatches]
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  const qualified = profileMatches.filter((m) => m.matchScore >= 55).length;
  const topScore = matches[0]?.matchScore ?? 0;
  const demandScore = Math.min(100, Math.round(qualified * 7 + topScore * 0.3));
  const assignmentPotential = demandScore >= 70 ? "high" : demandScore >= 40 ? "medium" : "low";

  return { matches, buyerCount, demandScore, assignmentPotential, county: countyDisplay ?? input.county ?? null };
}

const getCachedCountyCapabilities = unstable_cache(
  async () => {
    const rows = await listCountySourceRows(true).catch(() => []);
    return rows.length ? buildCountyCapabilities(rows) : fallbackCountyCapabilities;
  },
  ["blackspire-county-capabilities"],
  { revalidate: 60 },
);

export async function getLiveCountyCapabilities(includeInactive = true): Promise<CountyCapability[]> {
  const counties = await getCachedCountyCapabilities();
  return includeInactive ? counties : counties.filter((county) => county.status === "active");
}

async function ensureOutreachDraftBucket(supabase: SupabaseClient) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(error.message);
  }

  const exists = (buckets ?? []).some((bucket) => bucket.name === OUTREACH_DRAFT_BUCKET);
  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(OUTREACH_DRAFT_BUCKET, {
    public: false,
    fileSizeLimit: 1024 * 1024,
  });

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message);
  }
}

function getOutreachDraftObjectPath(userId: string, record: OutreachDraftRecord) {
  const safeSearchJobId = record.searchJobId.trim();
  const safeRecordId = record.id.trim();
  return `${userId}/${safeSearchJobId}__${safeRecordId}.json`;
}

export async function listOutreachDraftRecords(searchJobId?: string): Promise<OutreachDraftRecord[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const scope = await getOperatorScope("read");
  if (scope.requiresAuth || !scope.operatorId) return [];
  const userId = scope.operatorId;
  const supabase = getSupabaseAdmin();
  await ensureOutreachDraftBucket(supabase);

  const { data: objects, error } = await supabase.storage
    .from(OUTREACH_DRAFT_BUCKET)
    .list(userId, {
      limit: 100,
      sortBy: { column: "name", order: "desc" },
    });

  if (error) {
    throw new Error(error.message);
  }

  const fileNames = (objects ?? [])
    .filter((item) => item.name.endsWith(".json"))
    .map((item) => item.name);

  const drafts = await Promise.all(
    fileNames.map(async (fileName) => {
      const { data, error: downloadError } = await supabase.storage
        .from(OUTREACH_DRAFT_BUCKET)
        .download(`${userId}/${fileName}`);

      if (downloadError || !data) {
        return null;
      }

      try {
        const parsed = JSON.parse(await data.text()) as OutreachDraftRecord;
        return parsed;
      } catch {
        return null;
      }
    }),
  );

  return drafts
    .filter((draft): draft is OutreachDraftRecord => Boolean(draft))
    .filter((draft) => (searchJobId ? draft.searchJobId === searchJobId : true))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
}

export async function countOutreachDraftRecords(): Promise<number> {
  const env = getEnvState();
  if (!env.enabled) return 0;

  const scope = await getOperatorScope("read");
  if (scope.requiresAuth || !scope.operatorId) return 0;
  const userId = scope.operatorId;
  const supabase = getSupabaseAdmin();
  await ensureOutreachDraftBucket(supabase);

  const { data: objects, error } = await supabase.storage
    .from(OUTREACH_DRAFT_BUCKET)
    .list(userId, {
      limit: 100,
      sortBy: { column: "name", order: "desc" },
    });

  if (error) {
    throw new Error(error.message);
  }

  return (objects ?? []).filter((item) => item.name.endsWith(".json")).length;
}

export async function persistOutreachDraftRecord(record: OutreachDraftRecord): Promise<OutreachDraftRecord[]> {
  const env = getEnvState();
  if (!env.enabled) {
    throw new Error(`Missing Supabase env: ${env.missing.join(", ")}`);
  }

  const scope = await getOperatorScope("write");
  const userId = scope.operatorId!;
  const supabase = getSupabaseAdmin();
  await ensureOutreachDraftBucket(supabase);

  const objectPath = getOutreachDraftObjectPath(userId, record);
  const { error } = await supabase.storage
    .from(OUTREACH_DRAFT_BUCKET)
    .upload(objectPath, JSON.stringify(record, null, 2), {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  return listOutreachDraftRecords(record.searchJobId);
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const env = getEnvState();
  if (!env.enabled) {
    return {
      operatorId: null,
      searchJobCount: 0,
      completedJobCount: 0,
      processingJobCount: 0,
      failedJobCount: 0,
      buyerReportCount: 0,
      exportCount: 0,
      outreachDraftCount: 0,
    };
  }

  const supabase = getSupabaseAdmin();
  const scope = await getOperatorScope("read");
  const operatorId = scope.operatorId;
  if (scope.requiresAuth || !operatorId) {
    return {
      operatorId: null,
      searchJobCount: 0,
      completedJobCount: 0,
      processingJobCount: 0,
      failedJobCount: 0,
      buyerReportCount: 0,
      exportCount: 0,
      outreachDraftCount: 0,
    };
  }

  let jobQuery = supabase.from("SearchJob").select("status", { count: "exact" });
  const reportQuery = supabase.from("BuyerReport").select("id", { count: "exact", head: true });
  let exportQuery = supabase.from("exports").select("id", { count: "exact", head: true });

  jobQuery = jobQuery.eq("user_id", operatorId);
  exportQuery = exportQuery.eq("user_id", operatorId);

  const [{ data: jobs, count: jobCount, error: jobsError }, { count: reportCount, error: reportError }, { count: exportCount, error: exportError }, outreachDraftCount] =
    await Promise.all([
      jobQuery,
      reportQuery,
      exportQuery,
      countOutreachDraftRecords().catch(() => 0),
    ]);

  if (jobsError) {
    throw new Error(jobsError.message);
  }
  if (reportError) {
    throw new Error(reportError.message);
  }
  if (exportError) {
    throw new Error(exportError.message);
  }

  const searchJobs = (jobs ?? []) as Array<{ status: SearchJobRecord["status"] }>;

  return {
    operatorId,
    searchJobCount: jobCount ?? 0,
    completedJobCount: searchJobs.filter((job) => job.status === "completed").length,
    processingJobCount: searchJobs.filter((job) => job.status === "processing").length,
    failedJobCount: searchJobs.filter((job) => job.status === "failed").length,
    buyerReportCount: reportCount ?? 0,
    exportCount: exportCount ?? 0,
    outreachDraftCount,
  };
}

function getWebhookBaseUrl() {
  return process.env.N8N_WEBHOOK_BASE_URL?.trim() || "https://cpearson0312.app.n8n.cloud/webhook";
}

async function getActiveCountySource(county: string, state: string): Promise<CountyDataSourceRecord | null> {
  const env = getEnvState();
  if (!env.enabled) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("CountyDataSource")
    .select("county,state,source_type,source_url,active,notes")
    .eq("county", county)
    .eq("state", state)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as CountyDataSourceRecord | null) ?? null;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Wake source fetch failed with status ${response.status}.`);
    }

    return (await response.json()) as {
      features?: Array<{ attributes?: Record<string, unknown>; properties?: Record<string, unknown> }>;
      error?: { message?: string };
    };
  } finally {
    clearTimeout(timer);
  }
}

async function postArcgisQueryWithTimeout(url: string, params: URLSearchParams, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`ArcGIS source fetch failed with status ${response.status}.`);
    }

    return (await response.json()) as {
      features?: Array<{ attributes?: Record<string, unknown>; properties?: Record<string, unknown> }>;
      error?: { message?: string };
    };
  } finally {
    clearTimeout(timer);
  }
}

async function postLegacyForsythJson(formattedPin: string) {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("https://lrcpwa.ncptscloud.com/api/GetParcelDetailsByQueryParam", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Tenant": "forsyth",
      },
      body: JSON.stringify({
        searchKey: "pin",
        searchValue: formattedPin,
      }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function triggerBuyerEngineWorkflow(job: SearchJobRecord) {
  const webhookUrl = `${getWebhookBaseUrl().replace(/\/$/, "")}/buyer-engine`;
  const payload: Record<string, unknown> = {
    search_job_id: job.id,
    user_id: job.user_id,
    state: job.state,
    county: job.county,
    property_type: job.property_type,
    date_range_start: job.date_range_start,
    date_range_end: job.date_range_end,
    min_purchases: job.min_purchases ?? 1,
    cash_buyers_only: job.cash_buyers_only ?? false,
    llc_buyers_only: job.llc_buyers_only ?? false,
  };

  // Preserve the current composition until the coordinated scoped-writer switch.
  // The scoped issuer uses the same pure adapters with a fixed source snapshot
  // and bounded transport; it must never inherit these legacy network callbacks.
  const adapters = createBuyerSourceAdapters({
    resolveSource: (county, state) => county.trim().toLowerCase() === "mecklenburg"
      ? getActiveCountySource(county, state).catch(() => null)
      : getActiveCountySource(county, state),
    getJson: fetchJsonWithTimeout,
    postFormJson: postArcgisQueryWithTimeout,
    postForsythJson: postLegacyForsythJson,
  });
  const rawSales = await adapters.prefetch(job);
  if (rawSales !== null) {
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    let parsed: unknown = null;
    let rawText = "";
    try {
      rawText = await response.text();
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const supabase = getSupabaseAdmin();
      const detail = rawText.trim() ? ` Response: ${rawText.trim().slice(0, 400)}.` : "";
      await supabase
        .from("SearchJob")
        .update({
          status: "failed",
          error_message: `Workflow trigger failed with status ${response.status}.${detail}`,
        })
        .eq("id", job.id);

      throw new Error(`Workflow trigger failed with status ${response.status}.${detail}`);
    }

    return {
      webhookUrl,
      status: response.status,
      response: parsed,
    };
  } catch (error) {
    const supabase = getSupabaseAdmin();
    await supabase
      .from("SearchJob")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Workflow trigger failed.",
      })
      .eq("id", job.id);

    throw error;
  }
}

function normalizeBuyerReverseSearchCriteria(criteria: BuyerReverseSearchCriteria): BuyerReverseSearchCriteria {
  const targetZipCodes = (criteria.targetZipCodes ?? [])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    buyerName: criteria.buyerName?.trim() || "",
    buyerGroup: criteria.buyerGroup?.trim() || "",
    targetCounty: criteria.targetCounty?.trim() || "",
    targetCity: criteria.targetCity?.trim() || "",
    targetZipCodes,
    propertyType: criteria.propertyType?.trim() || "",
    minBeds:
      criteria.minBeds == null || Number.isNaN(Number(criteria.minBeds))
        ? null
        : Number(criteria.minBeds),
    maxPrice:
      criteria.maxPrice == null || Number.isNaN(Number(criteria.maxPrice))
        ? null
        : Number(criteria.maxPrice),
    minimumArvSpread:
      criteria.minimumArvSpread == null || Number.isNaN(Number(criteria.minimumArvSpread))
        ? null
        : Number(criteria.minimumArvSpread),
    buyBoxNotes: criteria.buyBoxNotes?.trim() || "",
    buyerProfileType: criteria.buyerProfileType ?? "unknown",
    preferredRadius:
      criteria.preferredRadius == null || Number.isNaN(Number(criteria.preferredRadius))
        ? null
        : Number(criteria.preferredRadius),
    activeOnly: Boolean(criteria.activeOnly),
  };
}

async function listReverseSearchDealCandidates() {
  const env = getEnvState();
  if (!env.enabled) return [] as ReverseDealJoinRow[];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("deal_leads")
    .select(
      "id,seller_lead_id,property_address,county,city,state,zip_code,status,motivation_score,property_type,estimated_equity,recommended_next_action,deal_analysis(estimated_arv,maximum_allowable_offer,purchase_price_target,wholesale_spread),buyer_matches(buyer_score,exit_strategy,investor_type_recommendation)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    if (isMissingRelationError(error.message)) return [] as ReverseDealJoinRow[];
    throw new Error(error.message);
  }

  return (data ?? []) as ReverseDealJoinRow[];
}

function isSellerLeadActive(status: string) {
  return !/dead lead/i.test(status);
}

function isDealActive(status: string) {
  return !/dead|lost|archived|closed/i.test(status);
}

function estimateSellerLeadArv(lead: SellerLeadView) {
  return Math.max(
    Math.round(lead.assessedValue * 1.12),
    Math.round(lead.assessedValue + lead.estimatedEquity * 0.18),
    lead.assessedValue,
  );
}

function estimateSellerLeadMao(lead: SellerLeadView, estimatedArv: number) {
  const base = estimatedArv * 0.7;
  const equityAdjustment = Math.min(lead.estimatedEquity * 0.18, estimatedArv * 0.14);
  return Math.max(0, Math.round(base - equityAdjustment - 12000));
}

function buildBuyerProfileReason(criteria: BuyerReverseSearchCriteria, propertyType: string, spread: number) {
  switch (criteria.buyerProfileType) {
    case "flipper":
      if (spread >= 30000) return "Spread profile lines up with a flipper-style buy box.";
      return "";
    case "landlord":
      if (/duplex|triplex|quad|multifamily|townhome/i.test(propertyType)) {
        return "Property type leans rental-friendly for a landlord profile.";
      }
      return "";
    case "hedge_fund":
      if (/single family|single-family|sfr/i.test(propertyType)) {
        return "Single-family posture fits the cleaner institutional buy-box pattern.";
      }
      return "";
    case "cash_buyer":
      if (spread >= 20000) return "Margin profile gives a cash buyer room to move quickly.";
      return "";
    default:
      return "";
  }
}

function scoreReverseSearchMatch(input: {
  criteria: BuyerReverseSearchCriteria;
  county: string;
  city: string;
  zip: string;
  propertyType: string;
  estimatedArv: number;
  estimatedMao: number;
  motivationScore: number;
  contactConfidence: number | null;
  status: string;
  buyerDemandScore: number;
}) {
  const reasons: string[] = [];
  let score = 0;
  const county = input.county.trim().toLowerCase();
  const city = input.city.trim().toLowerCase();
  const zip = input.zip.trim().toLowerCase();
  const propertyType = input.propertyType.trim().toLowerCase();
  const spread = Math.max(0, input.estimatedArv - input.estimatedMao);

  if (input.criteria.targetCounty && county === input.criteria.targetCounty.trim().toLowerCase()) {
    score += 24;
    reasons.push("County matches buyer target.");
  }

  if (input.criteria.targetCity && city === input.criteria.targetCity.trim().toLowerCase()) {
    score += 16;
    reasons.push("City matches buyer target.");
  }

  if (
    input.criteria.targetZipCodes?.length
    && input.criteria.targetZipCodes.some((item) => item.trim().toLowerCase() === zip)
  ) {
    score += 18;
    reasons.push("Zip matches buyer target.");
  }

  if (
    input.criteria.propertyType
    && propertyType.includes(input.criteria.propertyType.trim().toLowerCase())
  ) {
    score += 16;
    reasons.push("Property type matches the stated buy box.");
  }

  if (input.criteria.maxPrice != null) {
    if (input.estimatedMao > 0 && input.estimatedMao <= input.criteria.maxPrice) {
      score += 14;
      reasons.push("Estimated MAO fits under the buyer's max price.");
    } else if (input.estimatedMao > input.criteria.maxPrice * 1.1) {
      score -= 8;
    }
  }

  if (input.criteria.minimumArvSpread != null) {
    if (spread >= input.criteria.minimumArvSpread) {
      score += 16;
      reasons.push("ARV spread clears the buyer's minimum threshold.");
    } else {
      score -= 10;
    }
  } else if (spread >= 30000) {
    score += 12;
    reasons.push("High equity spread supports a strong wholesale lane.");
  } else if (spread >= 15000) {
    score += 7;
  }

  if (input.motivationScore >= 80) {
    score += 14;
    reasons.push("Strong seller motivation supports faster movement.");
  } else if (input.motivationScore >= 60) {
    score += 8;
  }

  if (input.contactConfidence != null) {
    if (input.contactConfidence >= 70) {
      score += 10;
      reasons.push("Contact confidence is strong enough for quick operator follow-through.");
    } else if (input.contactConfidence < 45) {
      score -= 6;
    }
  }

  if (/offer ready|under contract|negotiating|contact ready|reviewing/i.test(input.status)) {
    score += 8;
    reasons.push("Current stage is active enough to act on now.");
  }

  if (input.buyerDemandScore >= 70) {
    score += 12;
    reasons.push("Existing buyer demand signals are already strong.");
  } else if (input.buyerDemandScore >= 45) {
    score += 6;
  }

  const buyerProfileReason = buildBuyerProfileReason(
    input.criteria,
    input.propertyType,
    spread,
  );
  if (buyerProfileReason) {
    score += 8;
    reasons.push(buyerProfileReason);
  }

  return {
    matchScore: Math.max(1, Math.min(99, Math.round(score))),
    matchReasons: reasons.slice(0, 5),
  };
}

export async function runBuyerReverseSearch(
  rawCriteria: BuyerReverseSearchCriteria,
): Promise<BuyerReverseSearchResult> {
  const criteria = normalizeBuyerReverseSearchCriteria(rawCriteria);
  const [sellerLeads, dealCandidates] = await Promise.all([
    listSellerLeads().catch(() => []),
    listReverseSearchDealCandidates().catch(() => []),
  ]);

  const filteredSellerLeads = criteria.activeOnly
    ? sellerLeads.filter((lead) => isSellerLeadActive(lead.status))
    : sellerLeads;

  const filteredDeals = criteria.activeOnly
    ? dealCandidates.filter((deal) => isDealActive(deal.status ?? ""))
    : dealCandidates;

  const sellerMatches: BuyerReverseSearchMatch[] = filteredSellerLeads.map((lead) => {
    const estimatedArv = estimateSellerLeadArv(lead);
    const estimatedMao = estimateSellerLeadMao(lead, estimatedArv);
    const scored = scoreReverseSearchMatch({
      criteria,
      county: lead.county,
      city: lead.city,
      zip: lead.zipCode,
      propertyType: lead.propertyType,
      estimatedArv,
      estimatedMao,
      motivationScore: lead.score,
      contactConfidence: lead.contactConfidenceScore ?? null,
      status: lead.status,
      buyerDemandScore: lead.relatedDealId ? 55 : 0,
    });

    return {
      id: `seller-${lead.id}`,
      sourceType: "seller_lead",
      sourceId: lead.id,
      propertyAddress: lead.propertyAddress,
      city: lead.city,
      county: lead.county,
      zip: lead.zipCode,
      estimatedArv,
      estimatedMao,
      motivationScore: lead.score,
      matchScore: scored.matchScore,
      matchReasons:
        scored.matchReasons.length > 0
          ? scored.matchReasons
          : ["Seller-side opportunity is live, but it needs tighter buyer-box alignment."],
      recommendedAction:
        lead.relatedDealId || /sent to deal engine/i.test(lead.status)
          ? "Open the linked deal lane, tighten the packet, and align it to this buyer box."
          : "Review the seller record, verify contact posture, and send it into Deal Engine if the box still fits.",
      link: lead.relatedDealId ? `/workspace/deal-engine/${encodeURIComponent(lead.relatedDealId)}` : "/seller-engine",
    };
  });

  const dealMatches: BuyerReverseSearchMatch[] = filteredDeals.map((deal) => {
    const analysis = asSingle(deal.deal_analysis);
    const buyerMatch = asSingle(deal.buyer_matches);
    const estimatedArv = Math.max(0, Math.round(asNumber(analysis?.estimated_arv)));
    const estimatedMao = Math.max(
      0,
      Math.round(
        asNumber(analysis?.maximum_allowable_offer) || asNumber(analysis?.purchase_price_target),
      ),
    );
    const scored = scoreReverseSearchMatch({
      criteria,
      county: deal.county ?? "",
      city: deal.city ?? "",
      zip: deal.zip_code ?? "",
      propertyType: deal.property_type ?? "",
      estimatedArv,
      estimatedMao,
      motivationScore: asNumber(deal.motivation_score),
      contactConfidence: deal.seller_lead_id ? 68 : null,
      status: deal.status ?? "",
      buyerDemandScore: asNumber(buyerMatch?.buyer_score),
    });

    return {
      id: `deal-${deal.id}`,
      sourceType: "deal",
      sourceId: deal.id,
      propertyAddress: deal.property_address ?? "Unknown property",
      city: deal.city ?? "",
      county: deal.county ?? "",
      zip: deal.zip_code ?? "",
      estimatedArv,
      estimatedMao,
      motivationScore: asNumber(deal.motivation_score),
      matchScore: Math.min(99, scored.matchScore + 6),
      matchReasons:
        scored.matchReasons.length > 0
          ? scored.matchReasons
          : ["Existing Deal Engine record is available, but the buyer-box overlap is still soft."],
      recommendedAction:
        deal.recommended_next_action?.trim()
        || "Open the deal in Deal Engine, tune the packet to the buyer box, and prepare the next release.",
      link: `/workspace/deal-engine/${encodeURIComponent(deal.id)}`,
    };
  });

  const dedupedByAddress = new Map<string, BuyerReverseSearchMatch>();
  for (const match of [...dealMatches, ...sellerMatches]) {
    if (match.matchScore < 18) continue;
    const key = `${match.propertyAddress.trim().toLowerCase()}|${match.zip}`;
    const current = dedupedByAddress.get(key);
    if (!current || match.matchScore > current.matchScore) {
      dedupedByAddress.set(key, match);
    }
  }

  const matches = [...dedupedByAddress.values()].sort((left, right) => {
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    if (right.motivationScore !== left.motivationScore) return right.motivationScore - left.motivationScore;
    if (right.estimatedArv !== left.estimatedArv) return right.estimatedArv - left.estimatedArv;
    return left.propertyAddress.localeCompare(right.propertyAddress);
  });

  return {
    criteria,
    matches,
    generatedAt: new Date().toISOString(),
  };
}
