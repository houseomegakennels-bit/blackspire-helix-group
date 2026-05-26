import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const ACCESS_TOKEN_COOKIE = "blackspire-access-token";
export const REFRESH_TOKEN_COOKIE = "blackspire-refresh-token";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL?.trim() || "";
}

function getSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY?.trim() || "";
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

export function hasPublicAuthEnv() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function hasAdminAuthEnv() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

export function createPublicSupabaseAuthClient() {
  if (!hasPublicAuthEnv()) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY for operator sign-in.");
  }

  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAdminSupabaseAuthClient() {
  if (!hasAdminAuthEnv()) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for operator auth administration.");
  }

  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function getAuthTokensFromCookies() {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_TOKEN_COOKIE)?.value || null,
    refreshToken: store.get(REFRESH_TOKEN_COOKIE)?.value || null,
  };
}

export async function getAuthenticatedOperator() {
  const { accessToken } = await getAuthTokensFromCookies();
  if (!accessToken || !hasAdminAuthEnv()) {
    return null;
  }

  const supabase = createAdminSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function countAuthUsers() {
  if (!hasAdminAuthEnv()) {
    return 0;
  }

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users?page=1&per_page=1`, {
    method: "GET",
    headers: {
      apikey: getSupabaseServiceRoleKey(),
      Authorization: `Bearer ${getSupabaseServiceRoleKey()}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Auth user count failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { users?: Array<unknown> };
  return payload.users?.length ?? 0;
}
