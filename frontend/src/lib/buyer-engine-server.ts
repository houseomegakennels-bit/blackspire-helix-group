import "server-only";

import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildCountyCapabilities,
  fallbackCountyCapabilities,
  type CountyCapability,
  type CountySourceRow,
} from "@/lib/buyer-engine-data";

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

type CreateSearchJobInput = {
  title: string;
  state: string;
  county: string;
  propertyType: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  notes?: string;
};

type CreateExportInput = {
  searchJobId?: string | null;
  fileName: string;
  rowCount: number;
  storagePath?: string;
};

type EnvState = {
  enabled: boolean;
  missing: string[];
};

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

export async function listSearchJobs(limit = 12): Promise<SearchJobRecord[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  const userId = getDefaultUserId();

  let query = supabase
    .from("SearchJob")
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq("user_id", userId);
  }

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
  let query = supabase
    .from("SearchJob")
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .eq("id", searchJobId)
    .limit(1);

  const userId = getDefaultUserId();
  if (userId) {
    query = query.eq("user_id", userId);
  }

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
  const uniqueIds = [...new Set(searchJobIds.filter(Boolean))];
  let query = supabase
    .from("SearchJob")
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .in("id", uniqueIds);

  const userId = getDefaultUserId();
  if (userId) {
    query = query.eq("user_id", userId);
  }

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

  const userId = getDefaultUserId();
  if (!userId) {
    throw new Error("Missing BLACKSPIRE_DEFAULT_USER_ID. Auth is not wired yet, so the server needs a default user id for inserts.");
  }

  const supabase = getSupabaseAdmin();
  const payload = {
    user_id: userId,
    state: input.state.trim().toUpperCase(),
    county: input.county.trim(),
    property_type: input.propertyType,
    date_range_start: toIsoDate(input.dateRangeStart),
    date_range_end: toIsoDate(input.dateRangeEnd),
    min_purchases: 2,
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
    .select("id,search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer,created_at")
    .eq("search_job_id", searchJobId)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as BuyerReportRecord[];
}

export async function listAllBuyerReports({
  limit = 50,
  searchJobId,
}: {
  limit?: number;
  searchJobId?: string;
} = {}): Promise<BuyerReportRecord[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("BuyerReport")
    .select("id,search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (searchJobId) {
    query = query.eq("search_job_id", searchJobId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as BuyerReportRecord[];
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
  let query = supabase
    .from("exports")
    .select("id,user_id,search_job_id,file_name,storage_path,row_count,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  const userId = getDefaultUserId();
  if (userId) {
    query = query.eq("user_id", userId);
  }

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

  const userId = getDefaultUserId();
  if (!userId) {
    throw new Error("Missing BLACKSPIRE_DEFAULT_USER_ID. Export persistence needs a default user id until auth is wired.");
  }

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

function getWebhookBaseUrl() {
  return process.env.N8N_WEBHOOK_BASE_URL?.trim() || "https://cpearson0312.app.n8n.cloud/webhook";
}

export async function triggerBuyerEngineWorkflow(job: SearchJobRecord) {
  const webhookUrl = `${getWebhookBaseUrl().replace(/\/$/, "")}/buyer-engine`;
  const payload = {
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
