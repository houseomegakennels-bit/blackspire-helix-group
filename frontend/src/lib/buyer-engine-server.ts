import "server-only";

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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("BuyerReport")
    .select("id,search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer,created_at,BuyerProfile(score_breakdown)")
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
  if (!env.enabled) {
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
      "id,search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer,created_at,BuyerProfile(score_breakdown)",
      { count: "exact" },
    )
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

export async function listBuyerGroupRegistry(includeInactive = true): Promise<BuyerGroupRegistryRow[]> {
  const env = getEnvState();
  if (!env.enabled) {
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
    if (isMissingRelationError(error.message)) {
      const seeds = seedBuyerGroupRows();
      return includeInactive ? seeds : seeds.filter((row) => row.active);
    }
    throw new Error(error.message);
  }

  const resolvedRows = await ensureBuyerGroupRegistrySeeded(
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

function isWakeLandJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "wake" && job.property_type.trim().toLowerCase() === "land";
}

function isLincolnLandJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "lincoln" && job.property_type.trim().toLowerCase() === "land";
}

function isForsythJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "forsyth";
}

function isBrunswickJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "brunswick";
}

function isOrangeJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "orange";
}

function isBeaufortJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "beaufort";
}

function isAsheJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "ashe";
}

function isAveryJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "avery";
}

function isBurkeJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "burke";
}

function isWilkesJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "wilkes";
}

function isHaywoodJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "haywood";
}

function isSampsonJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "sampson";
}

function isDavieJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "davie";
}

function isCatawbaJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "catawba";
}

function isEdgecombeJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "edgecombe";
}

function isNashJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "nash";
}

function isGranvilleJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "granville";
}

function isDuplinJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "duplin";
}

function getWakeDateRangeFilter(job: SearchJobRecord) {
  const filters = ["TOTSALPRICE > 0", "LAND_CLASS = 'VAC'"];

  if (job.date_range_start) {
    filters.push(`SALE_DATE >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`SALE_DATE <= DATE '${job.date_range_end} 23:59:59'`);
  }

  return filters.join(" AND ");
}

function getLincolnDateRangeFilter(job: SearchJobRecord) {
  const filters = ["AMSLAM > 0", "VACANT = 'YES'"];

  if (job.date_range_start) {
    filters.push(`AMDTSL >= ${job.date_range_start.replaceAll("-", "")}`);
  }

  if (job.date_range_end) {
    filters.push(`AMDTSL <= ${job.date_range_end.replaceAll("-", "")}`);
  }

  return filters.join(" AND ");
}

function getForsythDateRangeFilter(job: SearchJobRecord) {
  const filters = ["XFER_SALEPRICE > 0"];

  if (job.date_range_start) {
    filters.push(`XFER_XFERDATE >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`XFER_XFERDATE <= DATE '${job.date_range_end} 23:59:59'`);
  }

  return filters.join(" AND ");
}

function getBrunswickDateRangeFilter(job: SearchJobRecord) {
  const months: string[] = [];
  const start = job.date_range_start ? new Date(`${job.date_range_start}T00:00:00Z`) : new Date();
  const end = job.date_range_end ? new Date(`${job.date_range_end}T00:00:00Z`) : new Date();
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${String(month + 1).padStart(2, "0")}/%/${year}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  const filters = [`(${months.map((value) => `DeedDate LIKE '${value}'`).join(" OR ")})`];
  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(ActualYearBuilt IS NULL OR ActualYearBuilt = 0)");
  }

  return filters.join(" AND ");
}

function getOrangeDateRangeFilter(job: SearchJobRecord) {
  const filters: string[] = [];

  if (job.date_range_start) {
    filters.push(`DATESOLD >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`DATESOLD <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(BLDGVALUE = 0 OR BLDGCNT IS NULL OR YEARBUILT IS NULL)");
  }

  return filters.length ? filters.join(" AND ") : "1=1";
}

function getBeaufortDateRangeFilter(job: SearchJobRecord) {
  const filters = ["SALE_PRICE > 0"];

  if (job.date_range_start) {
    filters.push(`date_dt >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`date_dt <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(BLDG_VAL IS NULL OR BLDG_VAL = 0 OR NBR_BLDG = '0')");
  }

  return filters.join(" AND ");
}

function getAsheDateRangeFilter(job: SearchJobRecord) {
  const filters = ["SalePrice > 0"];

  if (job.date_range_start) {
    filters.push(`DeedDate >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`DeedDate <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(ParcelBuil IS NULL OR ParcelBuil = 0)");
  }

  return filters.join(" AND ");
}

function getAveryDateRangeFilter(job: SearchJobRecord) {
  const filters = ["SALEPRICE > 0"];

  if (job.date_range_start) {
    filters.push(`DEED_DATE >= ${job.date_range_start.replaceAll("-", "")}`);
  }

  if (job.date_range_end) {
    filters.push(`DEED_DATE <= ${job.date_range_end.replaceAll("-", "")}`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(BUILD_VALU IS NULL OR BUILD_VALU = 0 OR AYB IS NULL OR AYB = 0)");
  }

  return filters.join(" AND ");
}

function getBurkeDateRangeFilter(job: SearchJobRecord) {
  const filters = ["PKG_SALE_PRICE > 0"];

  if (job.date_range_start) {
    filters.push(`PKG_SALE_DATE >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`PKG_SALE_DATE <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push(
      "(TOTAL_BLDG_VALUE_ASSESSED IS NULL OR TOTAL_BLDG_VALUE_ASSESSED = 0 OR LAND_CLASS LIKE '%VAC%' OR LAND_CLASS LIKE '%LAND%')",
    );
  }

  return filters.join(" AND ");
}

function getWilkesDateRangeFilter(job: SearchJobRecord) {
  const filters = ["SALEPRICE > 0"];

  if (job.date_range_start) {
    filters.push(`SALEDATE >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`SALEDATE <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(COSTBLDGVA IS NULL OR COSTBLDGVA = 0 OR LANDTYPE LIKE '%VAC%' OR LANDTYPE LIKE '%LAND%')");
  }

  return filters.join(" AND ");
}

function getHaywoodDateRangeFilter(job: SearchJobRecord) {
  const filters = ["Sale_Price > 0"];

  if (job.date_range_start) {
    filters.push(`Sale_Date >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`Sale_Date <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push(
      "(Bldg_Value IS NULL OR Bldg_Value = 0 OR Land_Desc LIKE '%VAC%' OR Land_Desc LIKE '%LAND%' OR Bldg_Use_Code IS NULL)",
    );
  }

  return filters.join(" AND ");
}

function getSampsonDateRangeFilter(job: SearchJobRecord) {
  const filters: string[] = [];

  if (job.date_range_start) {
    filters.push(`DATE_RECOR >= '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`DATE_RECOR <= '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push(
      "(YEAR_BUILT IS NULL OR YEAR_BUILT = 0 OR SEG_TYPE_D LIKE '%LOT%' OR SEG_TYPE_D LIKE '%WOODLAND%' OR SEG_TYPE_D LIKE '%CROPLAND%' OR PARCEL_CLA = 'AGRICULTURE')",
    );
  }

  return filters.length ? filters.join(" AND ") : "1=1";
}

function getMonthLevelSaleFilter(job: SearchJobRecord, yearField: string, monthField: string) {
  const start = job.date_range_start ? new Date(`${job.date_range_start}T00:00:00Z`) : new Date();
  const end = job.date_range_end ? new Date(`${job.date_range_end}T00:00:00Z`) : new Date();
  const clauses: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    clauses.push(`(${yearField} = ${year} AND ${monthField} = ${month})`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return clauses.length ? `(${clauses.join(" OR ")})` : "1=1";
}

function getDavieDateRangeFilter(job: SearchJobRecord) {
  const filters = [getMonthLevelSaleFilter(job, "saleyear", "salemonth")];

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(parcelbuildingvalue IS NULL OR parcelbuildingvalue = 0)");
  }

  return filters.join(" AND ");
}

function getCatawbaDateRangeFilter(job: SearchJobRecord) {
  const filters = ["sale_amount > 0"];

  if (job.date_range_start) {
    filters.push(`sale_date >= DATE '${job.date_range_start}'`);
  }

  if (job.date_range_end) {
    filters.push(`sale_date <= DATE '${job.date_range_end}'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(bldg_value IS NULL OR bldg_value = 0 OR yr_built IS NULL OR class = 'NA')");
  }

  return filters.join(" AND ");
}

function getEdgecombeDateRangeFilter(job: SearchJobRecord) {
  const filters = ["salepr > 0"];

  if (job.date_range_start) {
    filters.push(`deeddate >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`deeddate <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(bldgval IS NULL OR bldgval = 0 OR pclass = '07' OR propdescr LIKE '%LAND%' OR propdescr LIKE '%LOT%')");
  }

  return filters.join(" AND ");
}

function getNashDateRangeFilter(job: SearchJobRecord) {
  const filters = ["SALEPRICE > 0"];

  if (job.date_range_start) {
    filters.push(`SALEDATE >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`SALEDATE <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(TOT_B_VAL IS NULL OR TOT_B_VAL = 0)");
  }

  return filters.join(" AND ");
}

function getGranvilleDateRangeFilter(job: SearchJobRecord) {
  const filters = ["SalePrice > 0"];

  if (job.date_range_start) {
    filters.push(`DeedDate >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`DeedDate <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(BuildingValue IS NULL OR BuildingValue = 0)");
  }

  return filters.join(" AND ");
}

function getDuplinDateRangeFilter(job: SearchJobRecord) {
  const months: string[] = [];
  const start = job.date_range_start ? new Date(`${job.date_range_start}T00:00:00Z`) : new Date();
  const end = job.date_range_end ? new Date(`${job.date_range_end}T00:00:00Z`) : new Date();
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${String(month + 1).padStart(2, "0")}/%/${year}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  const filters = ["SalePrice <> '0'", `(${months.map((value) => `DeedDate LIKE '${value}'`).join(" OR ")})`];

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(ActualYearBuilt IS NULL OR ActualYearBuilt = '0')");
  }

  return filters.join(" AND ");
}

function parseDuplinDate(value: unknown) {
  const [month, day, year] = String(value ?? "").split("/");
  if (!month || !day || !year) return null;
  const normalized = `${year.padStart(4, "20")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
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

async function fetchWakeCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Wake County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 20;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getWakeDateRangeFilter(job),
      outFields: "PIN_NUM,REID,OWNER,ADDR1,ADDR2,SITE_ADDRESS,TOTSALPRICE,SALE_DATE,LAND_CLASS",
      returnGeometry: "false",
      orderByFields: "SALE_DATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await postArcgisQueryWithTimeout(baseUrl, params, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_wake",
        _no_cash_data: false,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchLincolnCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Lincoln County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 20;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getLincolnDateRangeFilter(job),
      outFields: "NAME1,NAME2,ADDRESS1,ADDRESS2,CITY,STATE,ZIP,PHYSICALADDR,AMSLAM,AMDTSL,DEEDBK,DEEDPG,PIN,VACANT",
      returnGeometry: "false",
      orderByFields: "AMDTSL DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await postArcgisQueryWithTimeout(baseUrl, params, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchBrunswickCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Brunswick County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const rawSales: Array<Record<string, unknown>> = [];
  const params = new URLSearchParams({
    where: getBrunswickDateRangeFilter(job),
    outFields:
      "ParcelNumber,PIN,Name1,Name2,Address1,Address2,Address3,City,State,ZipCode,HouseNumber,StreetName,StreetType,StreetDirection,UseCode,ActualYearBuilt,DeedDate,DeedBook,DeedPage,LandModel,LegalDescription",
    returnGeometry: "false",
    orderByFields: "DeedDate DESC",
    resultRecordCount: String(pageSize),
    resultOffset: "0",
    f: "json",
  });

  const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const pageRows = (payload.features ?? []).map(
    (feature) => feature.attributes ?? feature.properties ?? {},
  );

  rawSales.push(
    ...pageRows.map((row) => ({
      ...row,
      _source_type: "arcgis",
      _no_cash_data: true,
    })),
  );

  return rawSales;
}

async function fetchOrangeCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Orange County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const rawSales: Array<Record<string, unknown>> = [];
  const params = new URLSearchParams({
    where: getOrangeDateRangeFilter(job),
    outFields:
      "PIN,OWNER1,OWNER2,ADDRESS1,ADDRESS2,CITY,STATE,ZIPCODE,LANDVALUE,BLDGVALUE,BLDGCNT,VALUATION,DEEDREF,DATESOLD,DATESOLDTXT,YEARBUILT,SQFT,LEGAL_DESC",
    returnGeometry: "false",
    orderByFields: "DATESOLD DESC",
    resultRecordCount: String(pageSize),
    resultOffset: "0",
    f: "json",
  });

  const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const pageRows = (payload.features ?? []).map(
    (feature) => feature.attributes ?? feature.properties ?? {},
  );

  rawSales.push(
    ...pageRows.map((row) => ({
      ...row,
      _source_type: "arcgis",
      _no_cash_data: true,
    })),
  );

  return rawSales;
}

async function fetchBeaufortCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Beaufort County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getBeaufortDateRangeFilter(job),
      outFields:
        "REID,GPIN,GPINLONG,NAME1,NAME2,ADDR1,ADDR2,CITY,STATE,ZIP,PROP_DESC,LAND_VAL,BLDG_VAL,TOT_VAL,DEFR_VAL,ACRES,PROP_ADDR,PIN_1,DATE,SALE_PRICE,NBR_BLDG,LAND_USE,YR_BUILT,DB_PG,DEED_BOOK,DEED_PAGE,deed_link,date_dt,PRC,sqft_num",
      returnGeometry: "false",
      orderByFields: "date_dt DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_beaufort",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchAsheCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Ashe County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getAsheDateRangeFilter(job),
      outFields:
        "ParcelNumb,GPIN,Name1,Address1,Address2,Address3,City,State,ZipCode,LegalLandU,LegalLandT,DeedDate,DeedBook,DeedPage,SalePrice,SaleYear,ParcelProp,LegalDescr,ParcelLand,ParcelBuil,ParcelObxf,TotalMarke,TotalAsses,OwnershipT",
      returnGeometry: "false",
      orderByFields: "DeedDate DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_ashe",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchAveryCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Avery County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getAveryDateRangeFilter(job),
      outFields:
        "PIN,OWNER_NAME,NAME_1,ADDR_1,ADDR_2,ADDR_3,CITY,STATE,ZIP,ADDRESS,DEED_DATE,DEEDBOOK,DEEDPAGE,SALEPRICE,LAND_VALU,BUILD_VALU,TOTAL_VALU,AYB,ACREAGE,LEGAL_1,LEGAL_2,PARNUM,ACCT_NO,TAX_YEAR",
      returnGeometry: "false",
      orderByFields: "DEED_DATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_avery",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchBurkeCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Burke County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getBurkeDateRangeFilter(job),
      outFields:
        "PARCEL_PK,PIN,PIN_EXT,LOCATION_ADDR,LAND_CLASS,DEEDED_ACRES,PROPERTY_OWNER,OWNER_MAIL_1,OWNER_MAIL_2,OWNER_MAIL_3,OWNER_MAIL_CITY,OWNER_MAIL_STATE,OWNER_MAIL_ZIP,TOTAL_LAND_VALUE_ASSESSED,TOTAL_BLDG_VALUE_ASSESSED,LAND_USE_VALUE,DEED_DATE,DEED_BOOK,DEED_PAGE,PKG_SALE_DATE,PKG_SALE_PRICE,LAND_SALE_DATE,LAND_SALE_PRICE",
      returnGeometry: "false",
      orderByFields: "PKG_SALE_DATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_burke",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchWilkesCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Wilkes County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getWilkesDateRangeFilter(job),
      outFields:
        "PARCEL_ID,OWNER1,MAILADD1,MAILADD2,PIN,COSTLANDVA,COSTBLDGVA,LANDTYPE,YEARBUILT,EFFYEARBLT,SALEPRICE,SALE_VALIDITY,SALETYPE,SALEDATE",
      returnGeometry: "false",
      orderByFields: "SALEDATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_wilkes",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchHaywoodCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Haywood County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getHaywoodDateRangeFilter(job),
      outFields:
        "ALPHA,Owner_1,Owner_2,Addr_1,Addr_2,Addr_3,CSZ,LegalRef_1,LegalRef_2,Calc_Acres,Prop_Addr,Sale_Date,Sale_Date_String,Sale_Price,Land_Value,Bldg_Value,Mkt_Value,Defer_Value,Assd_Value,Heated_Area,Yr_Built,Acct_Nbr,Bldg_Use_Code,Bldg_Use_Desc,Land_Code,Land_Desc,Prop_Desc,VALID_SALE_CODE,LAND_USE_CODE",
      returnGeometry: "false",
      orderByFields: "Sale_Date DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_haywood",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchSampsonCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Sampson County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getSampsonDateRangeFilter(job),
      outFields:
        "PIN,CURRENT_OW,CURRENT_AD,CURRENT_CI,CURRENT_ST,CURRENT_ZI,BK_PG,SALE_PRICE,DATE_RECOR,PARCEL_ADD,SEG_TYPE_D,USE_DESC,ASSESSED_V,PARCEL_CLA,DEED,YEAR_BUILT",
      returnGeometry: "false",
      orderByFields: "DATE_RECOR DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchDavieCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Davie County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getDavieDateRangeFilter(job),
      outFields:
        "countyid,ncpin,accountnumber,name1,name2,address1,address2,city,state,zipcode,legaldescription,total_acres,saleyear,salemonth,deed_bk_pg,platbook,platpage,parcelbuildingvalue,parcelobxfvalue,parcellandvalue,totalmarketvalue,totalassessedvalue",
      returnGeometry: "false",
      orderByFields: "saleyear DESC,salemonth DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchCatawbaCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Catawba County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getCatawbaDateRangeFilter(job),
      outFields:
        "pinc,lrk,owner,owner2,address,address2,city,state,zip,taxaccount,deed_bk,deed_pg,tax_city,tax_fire,township,neighborhood,class,legal,bldg_value,land_value,defr_value,total_value,yr_built,yr_remodeled,sale_amount,owner_count,deed_date,sale_date",
      returnGeometry: "false",
      orderByFields: "pinc",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchEdgecombeCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Edgecombe County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getEdgecombeDateRangeFilter(job),
      outFields:
        "parcel,owner,address,city,st,zip,location,propdescr,deeddate,salepr,bk_pg,account,twp,acreage,landval,bldgval,netval,deferred,subdivisio,pclass,pin,pinsuf,altpin,linkpin,deeddatestr",
      returnGeometry: "false",
      orderByFields: "deeddate DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchNashCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Nash County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getNashDateRangeFilter(job),
      outFields:
        "GIS_PARID,GIS_PIN,TAX_PARID,TAX_PIN,OWNER1,OWNER2,CAREOF,MAIL_ADDR1,MAIL_ADDR2,ML_C_ST_Z,PHYS_ADDR,DESCRIPLOC,LANDTYPE,DEEDACRES,GIS_ACRES,DEEDBOOK,DEEDPAGE,SALEDATE,SALECODE,SALEPRICE,PROPTYPE,LANDVALUE,TOT_B_VAL,APR_VAL,ASM_VAL,LEGAL1,LEGAL2,LEGAL3",
      returnGeometry: "false",
      orderByFields: "SALEDATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await postArcgisQueryWithTimeout(baseUrl, params, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_nash",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchGranvilleCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Granville County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getGranvilleDateRangeFilter(job),
      outFields:
        "PIN,MAPN,PRODNO,RECN,Parcel,OwnerName1,OwnerName2,AddressLine1,AddressLine2,AddressLine3,City,State,Zip,FormattedPropertyAddress,LegalDescription,LandUnits,LandUnitsType,DeedDate,DeedBookPage,BuildingValue,LandValue,ObxfValue,AssessedValue,DeferredValue,MarketValue,SalePrice,PRC",
      returnGeometry: "false",
      orderByFields: "DeedDate DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows.map((row) => ({
        ...row,
        _source_type: "arcgis_granville",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

async function fetchDuplinCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Duplin County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 500;
  const maxPages = 10;
  const startMs = job.date_range_start ? Date.parse(`${job.date_range_start}T00:00:00Z`) : null;
  const endMs = job.date_range_end ? Date.parse(`${job.date_range_end}T23:59:59Z`) : null;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getDuplinDateRangeFilter(job),
      outFields:
        "PIN,ParcelNumber,PinNumber,AccountNumber,FormattedPropertyAddress,Name1,Name2,Address1,Address2,Address3,City,State,ZipCode,DeedBook,DeedPage,DeedDate,SalePrice,LegalLandUnits,LegalLandType,TotalAssessedValue,TotalMarketValue,ActualYearBuilt,HeatedAreaCard,ValuationModel",
      returnGeometry: "false",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    rawSales.push(
      ...pageRows
        .filter((row) => {
          const saleMs = parseDuplinDate(row.DeedDate);
          if (!saleMs) return false;
          if (startMs && saleMs < startMs) return false;
          if (endMs && saleMs > endMs) return false;
          return true;
        })
        .map((row) => ({
          ...row,
          _source_type: "arcgis_duplin",
          _no_cash_data: true,
        })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
}

function normalizeForsythSalesPin(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\.\d+$/, "")
    .replace(/[^0-9]/g, "");
}

function formatForsythPin(value: unknown) {
  const digits = normalizeForsythSalesPin(value);
  if (digits.length < 10) return String(value ?? "").trim();
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 10)}`;
}

async function fetchForsythParcelDetailByPin(pin: string) {
  const formattedPin = formatForsythPin(pin);
  if (!formattedPin) return null;

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

async function fetchForsythCountyRawSales(job: SearchJobRecord) {
  const source = await getActiveCountySource(job.county, job.state);
  if (!source?.source_url) {
    throw new Error("Forsyth County source row is missing a live source_url.");
  }

  const baseUrl = source.source_url.split("?")[0];
  const pageSize = 200;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getForsythDateRangeFilter(job),
      outFields: "XFER_PIN,XFER_ADDRESS,XFER_XFERDATE,XFER_SALEPRICE,XFER_BOOK,XFER_PAGE,XFER_PROPCLASS,TOTACREAGE,ResComYrBlt,ResComSqFt",
      returnGeometry: "false",
      orderByFields: "XFER_XFERDATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await fetchJsonWithTimeout(`${baseUrl}?${params.toString()}`, 20000);

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const pageRows = (payload.features ?? []).map(
      (feature) => feature.attributes ?? feature.properties ?? {},
    );

    if (pageRows.length === 0) {
      break;
    }

    for (const row of pageRows) {
      const salesPin = String(row.XFER_PIN ?? "");
      const detail = await fetchForsythParcelDetailByPin(salesPin);
      const mailingAddress = [
        detail?.mailingAddress1,
        detail?.mailingAddress2,
        detail?.mailingAddress3,
        detail?.mailingAddressCity,
        detail?.mailingAddressState,
        detail?.mailingAddressZip,
      ]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(", ");
      const propertyAddress = String(detail?.formattedPhysicalAddress ?? detail?.locationAddress ?? row.XFER_ADDRESS ?? "").trim();
      const buyerName = String(detail?.primaryOwnerName ?? "").trim();
      const deedDate = detail?.deedDate ? Date.parse(String(detail.deedDate)) : row.XFER_XFERDATE;

      if (!buyerName) {
        continue;
      }

      rawSales.push({
        ...row,
        CURRENTOWNERNAME1: buyerName,
        CURRENTOWNERNAME2: "",
        CURRENTOWNERADDRESS: mailingAddress,
        CURRENTOWNERCITYSTZIP: "",
        PROPERTYADDRESS: propertyAddress,
        LASTQUALIFIEDSALEPRICE: row.XFER_SALEPRICE,
        CURRENTDEEDDATE: Number.isFinite(deedDate as number) ? deedDate : row.XFER_XFERDATE,
        CURRENTDEEDBKPG: row.XFER_BOOK ? `Book ${String(row.XFER_BOOK).trim()} Page ${String(row.XFER_PAGE ?? "").trim()}` : "",
        TAXPIN: detail?.formattedPin ?? formatForsythPin(salesPin),
        BUYER_IDENTITY_METHOD: "current_owner_inferred",
        BUYER_IDENTITY_CONFIDENCE: "medium",
        BUYER_IDENTITY_REASON: "SalesApp transfer joined to NCPTS Cloud current parcel owner by PIN.",
        BUYER_IDENTITY_VERIFIED_AT: new Date().toISOString(),
        DEED_URL: detail?.deedBookUrl ?? "",
        _source_type: "arcgis_forsyth",
        _no_cash_data: true,
      });
    }

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales;
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

  if (isWakeLandJob(job)) {
    const rawSales = await fetchWakeCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isLincolnLandJob(job)) {
    const rawSales = await fetchLincolnCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isForsythJob(job)) {
    const rawSales = await fetchForsythCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isBrunswickJob(job)) {
    const rawSales = await fetchBrunswickCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isOrangeJob(job)) {
    const rawSales = await fetchOrangeCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isBeaufortJob(job)) {
    const rawSales = await fetchBeaufortCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isAsheJob(job)) {
    const rawSales = await fetchAsheCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isAveryJob(job)) {
    const rawSales = await fetchAveryCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isBurkeJob(job)) {
    const rawSales = await fetchBurkeCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isWilkesJob(job)) {
    const rawSales = await fetchWilkesCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isHaywoodJob(job)) {
    const rawSales = await fetchHaywoodCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isSampsonJob(job)) {
    const rawSales = await fetchSampsonCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isDavieJob(job)) {
    const rawSales = await fetchDavieCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isCatawbaJob(job)) {
    const rawSales = await fetchCatawbaCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isEdgecombeJob(job)) {
    const rawSales = await fetchEdgecombeCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isNashJob(job)) {
    const rawSales = await fetchNashCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isGranvilleJob(job)) {
    const rawSales = await fetchGranvilleCountyRawSales(job);
    payload.raw_sales = rawSales;
    payload.raw_count = rawSales.length;
  }

  if (isDuplinJob(job)) {
    const rawSales = await fetchDuplinCountyRawSales(job);
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
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const supabase = getSupabaseAdmin();
      await supabase
        .from("SearchJob")
        .update({
          status: "failed",
          error_message: `Workflow trigger failed with status ${response.status}.`,
        })
        .eq("id", job.id);

      throw new Error(`Workflow trigger failed with status ${response.status}.`);
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
