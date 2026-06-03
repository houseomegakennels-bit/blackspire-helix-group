import "server-only";

import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { generateReferralCode } from "@/lib/recon-engine/referrals";

/**
 * Recon Engine CUSTOMER auth — fully self-contained and isolated from Supabase
 * Auth (Buyer Engine operators). Customers live in `recon_accounts`, authenticate
 * with a scrypt-hashed password, and hold an HMAC-signed session cookie. They
 * never become Supabase Auth users, so they can never gain operator access.
 */

export const RECON_SESSION_COOKIE = "recon-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export type ReconAccount = {
  id: string;
  email: string;
  companyName: string | null;
  industry: string | null;
  serviceKeywords: string[];
  countiesServed: string[];
  certifications: string[];
  referralCode: string | null;
  referredBy: string | null;
  plan: string | null;
  billingModel: string | null;
};

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Missing Supabase server credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getSessionSecret(): string {
  const secret = process.env.RECON_SESSION_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("No session secret available.");
  return secret;
}

// ── password hashing (scrypt) ─────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = await scrypt(password, salt, 64);
  const a = Buffer.from(hashHex, "hex");
  if (a.length !== derived.length) return false;
  return timingSafeEqual(a, derived);
}

// ── session token (HMAC-signed) ───────────────────────────────────────────
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signSession(accountId: string): string {
  const payload = `${accountId}.${Date.now()}`;
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${b64url(payload)}.${sig}`;
}

function verifySession(token: string): string | null {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  const expected = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [accountId, issuedAt] = payload.split(".");
  if (!accountId || !issuedAt) return null;
  const ageMs = Date.now() - Number(issuedAt);
  if (!Number.isFinite(ageMs) || ageMs > SESSION_MAX_AGE_SECONDS * 1000) return null;
  return accountId;
}

export function buildSessionCookie(accountId: string) {
  return {
    name: RECON_SESSION_COOKIE,
    value: signSession(accountId),
    options: {
      httpOnly: true as const,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  };
}

function rowToAccount(row: Record<string, unknown>): ReconAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    companyName: (row.company_name as string) ?? null,
    industry: (row.industry as string) ?? null,
    serviceKeywords: (row.service_keywords as string[]) ?? [],
    countiesServed: (row.counties_served as string[]) ?? [],
    certifications: (row.certifications as string[]) ?? [],
    referralCode: (row.referral_code as string) ?? null,
    referredBy: (row.referred_by as string) ?? null,
    plan: (row.plan as string) ?? null,
    billingModel: (row.billing_model as string) ?? null,
  };
}

const ACCOUNT_COLUMNS =
  "id,email,company_name,industry,service_keywords,counties_served,certifications,referral_code,referred_by,plan,billing_model";

export async function createReconAccount(input: {
  email: string;
  password: string;
  companyName?: string;
  industry?: string;
  serviceKeywords?: string[];
  countiesServed?: string[];
  certifications?: string[];
  referredBy?: string | null;
}): Promise<ReconAccount> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from("recon_accounts").select("id").eq("email", email).maybeSingle();
  if (existing) throw new Error("An account with this email already exists.");

  const passwordHash = await hashPassword(input.password);
  const { data, error } = await supabase
    .from("recon_accounts")
    .insert({
      email,
      password_hash: passwordHash,
      company_name: input.companyName?.trim() || null,
      industry: input.industry?.trim() || null,
      service_keywords: input.serviceKeywords ?? null,
      counties_served: input.countiesServed ?? null,
      certifications: input.certifications ?? null,
      referred_by: input.referredBy?.trim() || null,
    })
    .select(`${ACCOUNT_COLUMNS}`)
    .single();
  if (error) throw new Error(error.message);

  // Assign a stable per-account referral code derived from the id.
  const referralCode = generateReferralCode(String(data.id));
  await supabase.from("recon_accounts").update({ referral_code: referralCode }).eq("id", data.id);

  // Record the referral relationship if they arrived via a code.
  if (input.referredBy?.trim()) {
    const { data: referrer } = await supabase
      .from("recon_accounts")
      .select("id")
      .eq("referral_code", input.referredBy.trim())
      .maybeSingle();
    if (referrer) {
      await supabase
        .from("referrals")
        .insert({ referrer_id: referrer.id, referred_user_id: data.id, status: "pending", reward_amount: 0 })
        .then(() => undefined, () => undefined);
    }
  }

  return rowToAccount({ ...data, referral_code: referralCode });
}

export async function authenticateReconAccount(email: string, password: string): Promise<ReconAccount> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("recon_accounts")
    .select(`${ACCOUNT_COLUMNS},password_hash`)
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Invalid email or password.");

  const ok = await verifyPassword(password, String(data.password_hash));
  if (!ok) throw new Error("Invalid email or password.");
  return rowToAccount(data);
}

/** Current logged-in Recon customer from the session cookie, or null. */
export async function getReconCustomer(): Promise<ReconAccount | null> {
  const store = await cookies();
  const token = store.get(RECON_SESSION_COOKIE)?.value;
  if (!token) return null;
  let accountId: string | null = null;
  try {
    accountId = verifySession(token);
  } catch {
    return null;
  }
  if (!accountId) return null;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("recon_accounts").select(`${ACCOUNT_COLUMNS}`).eq("id", accountId).maybeSingle();
  return data ? rowToAccount(data) : null;
}

export async function updateReconProfile(
  accountId: string,
  profile: {
    companyName?: string;
    industry?: string;
    serviceKeywords?: string[];
    countiesServed?: string[];
    certifications?: string[];
  },
): Promise<ReconAccount> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("recon_accounts")
    .update({
      company_name: profile.companyName?.trim() || null,
      industry: profile.industry?.trim() || null,
      service_keywords: profile.serviceKeywords ?? null,
      counties_served: profile.countiesServed ?? null,
      certifications: profile.certifications ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .select(`${ACCOUNT_COLUMNS}`)
    .single();
  if (error) throw new Error(error.message);
  return rowToAccount(data);
}
