import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SkipTraceLeadInput = {
  seller_lead_id?: string;
  seller_score?: number;
  owner_name: string;
  property_address: string;
  mailing_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  parcel_id?: string;
};

export type SkipTraceResult = {
  primary_phone: string | null;
  secondary_phone: string | null;
  additional_phones: string[];
  primary_email: string | null;
  additional_emails: string[];
  contact_confidence_score: number;
  phone_confidence: number;
  email_confidence: number;
  dnc_flag: boolean | null;
  litigator_flag?: boolean | null;
  skip_trace_status: string;
  skip_trace_provider: string;
  skip_trace_requested_at: string;
  skip_trace_completed_at: string;
  raw_skiptrace_response: Record<string, unknown>;
  provider_record_id?: string | null;
  matched_owner_name?: string | null;
  matched_mailing_address?: string | null;
  hit?: boolean;
  credits_used?: number;
};

export interface SkipTraceProvider {
  name: string;
  runTrace(input: SkipTraceLeadInput): Promise<Record<string, unknown>>;
  normalize(response: Record<string, unknown>): SkipTraceResult;
  estimateCredits(input: SkipTraceLeadInput): number;
}

export function calculateContactConfidence(data: {
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  dncFlag?: boolean | null;
}) {
  let score = 35;
  if (data.primaryPhone) score += 35;
  if (data.primaryEmail) score += 20;
  if (data.dncFlag) score -= 15;
  return Math.max(0, Math.min(score, 100));
}

export function checkSkipTraceEligibility(lead: SkipTraceLeadInput, minimumScore = 75) {
  return (lead.seller_score ?? 0) >= minimumScore;
}

const DEFAULT_TRACERFY_API_BASE_URL = "https://tracerfy.com";

type TracerfyPhone = {
  number?: string;
  type?: string;
  dnc?: boolean;
  carrier?: string;
  rank?: number | string;
};

type TracerfyEmail = {
  email?: string;
  rank?: number | string;
};

type TracerfyMailingAddress = {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
};

type TracerfyPerson = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  age?: number | string;
  deceased?: boolean;
  property_owner?: boolean;
  litigator?: boolean;
  mailing_address?: TracerfyMailingAddress;
  phones?: TracerfyPhone[];
  emails?: TracerfyEmail[];
};

type TracerfyLookupResponse = {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  find_owner?: boolean;
  hit?: boolean;
  persons_count?: number;
  credits_deducted?: number;
  persons?: TracerfyPerson[];
  error?: string;
  [key: string]: unknown;
};

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isUuid(value: string | undefined) {
  return Boolean(value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i));
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toRank(value: unknown) {
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : 999;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildNexusContactNote(input: SkipTraceLeadInput, result: SkipTraceResult) {
  return `NEXUS_CONTACT_RESULT ${JSON.stringify({
    source_lead_id: input.seller_lead_id ?? null,
    owner_name: input.owner_name,
    property_address: input.property_address,
    mailing_address: input.mailing_address ?? result.matched_mailing_address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    county: input.county ?? null,
    primary_phone: result.primary_phone,
    secondary_phone: result.secondary_phone,
    additional_phones: result.additional_phones,
    primary_email: result.primary_email,
    additional_emails: result.additional_emails,
    contact_confidence_score: result.contact_confidence_score,
    phone_confidence: result.phone_confidence,
    email_confidence: result.email_confidence,
    dnc_flag: result.dnc_flag,
    litigator_flag: result.litigator_flag,
    provider: result.skip_trace_provider,
    status: result.skip_trace_status,
    requested_at: result.skip_trace_requested_at,
    completed_at: result.skip_trace_completed_at,
  })}`;
}

function normalizePhoneNumber(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return normalized;
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value);
  return email ? email.toLowerCase() : null;
}

function formatMailingAddress(value: TracerfyMailingAddress | undefined) {
  const parts = [value?.street, value?.city, value?.state, value?.zip]
    .map((part) => cleanText(part))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function splitPropertyAddress(value: string) {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  const street = parts.slice(0, -2).join(", ").trim();
  const city = parts.at(-2)?.trim() ?? "";
  const stateZip = parts.at(-1)?.trim() ?? "";
  const stateZipMatch = stateZip.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
  if (!street || !city || !stateZipMatch?.[1]) return null;

  return {
    street,
    city,
    state: stateZipMatch[1].toUpperCase(),
    zip: stateZipMatch[2] ?? undefined,
  };
}

function buildTracerfyLookupPayload(input: SkipTraceLeadInput) {
  const parsed = splitPropertyAddress(input.property_address);
  const address = parsed?.street ?? cleanText(input.property_address);
  const city = cleanText(input.city) ?? parsed?.city ?? null;
  const state = cleanText(input.state)?.toUpperCase() ?? parsed?.state ?? null;
  const zip = cleanText(input.zip) ?? parsed?.zip ?? null;

  if (!address || !city || !state) {
    throw new Error(
      "Tracerfy lookup requires a full property address with street, city, and state. Update the lead record before running skip trace.",
    );
  }

  return {
    address,
    city,
    state,
    zip: zip ?? undefined,
    find_owner: true as const,
  };
}

function buildTracerfyUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (/\/v1\/api$/i.test(normalizedBase)) {
    return `${normalizedBase}${normalizedPath.replace(/^\/v1\/api/i, "")}`;
  }
  return `${normalizedBase}${normalizedPath}`;
}

function pickBestTracerfyPerson(persons: TracerfyPerson[]) {
  return [...persons].sort((left, right) => {
    const leftOwner = left.property_owner ? 1 : 0;
    const rightOwner = right.property_owner ? 1 : 0;
    if (leftOwner !== rightOwner) return rightOwner - leftOwner;

    const leftPhones = Array.isArray(left.phones) ? left.phones.length : 0;
    const rightPhones = Array.isArray(right.phones) ? right.phones.length : 0;
    if (leftPhones !== rightPhones) return rightPhones - leftPhones;

    const leftEmails = Array.isArray(left.emails) ? left.emails.length : 0;
    const rightEmails = Array.isArray(right.emails) ? right.emails.length : 0;
    return rightEmails - leftEmails;
  })[0];
}

function buildConfidenceScore(args: {
  hit: boolean;
  primaryPhone: string | null;
  primaryPhoneDnc: boolean | null;
  primaryPhoneType: string | null;
  phoneCount: number;
  primaryEmail: string | null;
  emailCount: number;
  propertyOwner: boolean;
}) {
  let score = args.hit ? 30 : 0;
  if (args.primaryPhone) score += 30;
  if (args.phoneCount > 1) score += 10;
  if (args.primaryEmail) score += 15;
  if (args.emailCount > 1) score += 5;
  if (args.primaryPhoneType?.toLowerCase() === "mobile") score += 5;
  if (args.propertyOwner) score += 5;
  if (args.primaryPhoneDnc) score -= 15;
  return Math.max(0, Math.min(score, 100));
}

export function normalizeTracerfyResponse(response: Record<string, unknown>): SkipTraceResult {
  const payload = toRecord(response) as TracerfyLookupResponse;
  const hit = Boolean(payload.hit);
  const persons = Array.isArray(payload.persons) ? payload.persons : [];
  const bestPerson = persons.length ? pickBestTracerfyPerson(persons) : undefined;
  const phones = Array.isArray(bestPerson?.phones)
    ? [...bestPerson.phones].sort((left, right) => toRank(left.rank) - toRank(right.rank))
    : [];
  const emails = Array.isArray(bestPerson?.emails)
    ? [...bestPerson.emails].sort((left, right) => toRank(left.rank) - toRank(right.rank))
    : [];
  const normalizedPhones = phones.map((phone) => ({
    ...phone,
    normalizedNumber: normalizePhoneNumber(phone.number),
  }));
  const normalizedEmails = emails.map((email) => normalizeEmail(email.email)).filter(Boolean) as string[];
  const primaryPhoneRecord = normalizedPhones.find((phone) => phone.normalizedNumber) ?? null;
  const primaryPhone = primaryPhoneRecord?.normalizedNumber ?? null;
  const secondaryPhone =
    normalizedPhones.filter((phone) => phone.normalizedNumber && phone.normalizedNumber !== primaryPhone)[0]?.normalizedNumber ?? null;
  const additionalPhones = normalizedPhones
    .map((phone) => phone.normalizedNumber)
    .filter((phone): phone is string => Boolean(phone) && phone !== primaryPhone && phone !== secondaryPhone);
  const primaryEmail = normalizedEmails[0] ?? null;
  const additionalEmails = normalizedEmails.slice(1);
  const dncFlag = typeof primaryPhoneRecord?.dnc === "boolean" ? primaryPhoneRecord.dnc : null;
  const litigatorFlag = typeof bestPerson?.litigator === "boolean" ? bestPerson.litigator : null;
  const matchedMailingAddress = formatMailingAddress(bestPerson?.mailing_address);
  const fallbackMatchedOwnerName = [cleanText(bestPerson?.first_name), cleanText(bestPerson?.last_name)]
    .filter(Boolean)
    .join(" ");
  const matchedOwnerName = cleanText(bestPerson?.full_name) ?? (fallbackMatchedOwnerName || null);
  const confidence = buildConfidenceScore({
    hit,
    primaryPhone,
    primaryPhoneDnc: dncFlag,
    primaryPhoneType: cleanText(primaryPhoneRecord?.type),
    phoneCount: normalizedPhones.filter((phone) => phone.normalizedNumber).length,
    primaryEmail,
    emailCount: normalizedEmails.length,
    propertyOwner: Boolean(bestPerson?.property_owner),
  });
  const phoneConfidence = primaryPhone
    ? Math.max(55, Math.min(confidence + (cleanText(primaryPhoneRecord?.type)?.toLowerCase() === "mobile" ? 8 : 0), 100))
    : Math.max(confidence - 30, 0);
  const emailConfidence = primaryEmail ? Math.max(45, Math.min(confidence, 100)) : Math.max(confidence - 25, 0);

  return {
    primary_phone: primaryPhone,
    secondary_phone: secondaryPhone,
    additional_phones: additionalPhones,
    primary_email: primaryEmail,
    additional_emails: additionalEmails,
    contact_confidence_score: confidence,
    phone_confidence: phoneConfidence,
    email_confidence: emailConfidence,
    dnc_flag: dncFlag,
    litigator_flag: litigatorFlag,
    skip_trace_status: hit && (primaryPhone || primaryEmail) ? "completed" : hit ? "partial_match" : "no_match",
    skip_trace_provider: "Tracerfy",
    skip_trace_requested_at: new Date().toISOString(),
    skip_trace_completed_at: new Date().toISOString(),
    raw_skiptrace_response: payload,
    provider_record_id: null,
    matched_owner_name: matchedOwnerName,
    matched_mailing_address: matchedMailingAddress,
    hit,
    credits_used: Number(payload.credits_deducted) || 0,
  };
}

export function handleTracerfyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Tracerfy request failed.";
  return {
    message,
    retryable: /429|temporarily unavailable|timeout|timed out|5\d\d/i.test(message),
    provider: "Tracerfy",
  };
}

export async function storeSkipTraceResult(input: SkipTraceLeadInput, result: SkipTraceResult) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return result;

  const sellerLeadId = isUuid(input.seller_lead_id) ? input.seller_lead_id ?? null : null;
  const requestPayload = {
    ...input,
    provider: "Tracerfy",
  };

  await supabase.from("skip_trace_requests").insert({
    seller_lead_id: sellerLeadId,
    provider: "Tracerfy",
    request_payload: requestPayload,
    response_payload: result.raw_skiptrace_response,
    status: result.skip_trace_status,
    credits_used: result.credits_used ?? 0,
    requested_by: "nexus-api",
    requested_at: result.skip_trace_requested_at,
    completed_at: result.skip_trace_completed_at,
  }).then(() => undefined, () => undefined);

  if (sellerLeadId) {
    await supabase.from("lead_notes").insert({
      seller_lead_id: sellerLeadId,
      note: buildNexusContactNote(input, result),
    }).then(() => undefined, () => undefined);
  } else {
    await supabase.from("lead_notes").insert({
      note: buildNexusContactNote(input, result),
    }).then(() => undefined, () => undefined);
  }

  const contactPayload = {
    seller_lead_id: sellerLeadId,
    owner_name: input.owner_name,
    property_address: input.property_address,
    mailing_address: input.mailing_address ?? result.matched_mailing_address ?? null,
    primary_phone: result.primary_phone,
    secondary_phone: result.secondary_phone,
    additional_phones: result.additional_phones,
    primary_email: result.primary_email,
    additional_emails: result.additional_emails,
    contact_confidence_score: result.contact_confidence_score,
    phone_confidence: result.phone_confidence,
    email_confidence: result.email_confidence,
    dnc_flag: result.dnc_flag,
    provider: result.skip_trace_provider,
    provider_record_id: result.provider_record_id,
    raw_response: result.raw_skiptrace_response,
    status: result.skip_trace_status,
    updated_at: result.skip_trace_completed_at,
  };

  let existingContactQuery = supabase
    .from("nexus_contacts")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);

  existingContactQuery = sellerLeadId
    ? existingContactQuery.eq("seller_lead_id", sellerLeadId)
    : existingContactQuery
      .is("seller_lead_id", null)
      .eq("owner_name", input.owner_name)
      .eq("property_address", input.property_address);

  const existingContact = await existingContactQuery.maybeSingle();

  if (existingContact.data?.id) {
    await supabase.from("nexus_contacts").update(contactPayload).eq("id", existingContact.data.id).then(() => undefined, () => undefined);
  } else {
    await supabase.from("nexus_contacts").insert(contactPayload).then(() => undefined, () => undefined);
  }

  if (!sellerLeadId) return result;

  const leadOwner = await supabase.from("seller_leads").select("owner_id").eq("id", sellerLeadId).maybeSingle();
  const ownerId = cleanText(leadOwner.data?.owner_id);
  if (ownerId) {
    await supabase
      .from("owners")
      .update({
        primary_phone: result.primary_phone,
        secondary_phone: result.secondary_phone,
        additional_phones: result.additional_phones,
        primary_email: result.primary_email,
        additional_emails: result.additional_emails,
        contact_confidence_score: result.contact_confidence_score,
        phone_confidence: result.phone_confidence,
        email_confidence: result.email_confidence,
        dnc_flag: result.dnc_flag,
        skip_trace_status: result.skip_trace_status,
        skip_trace_provider: result.skip_trace_provider,
        skip_trace_requested_at: result.skip_trace_requested_at,
        skip_trace_completed_at: result.skip_trace_completed_at,
        raw_skiptrace_response: result.raw_skiptrace_response,
        updated_at: result.skip_trace_completed_at,
      })
      .eq("id", ownerId)
      .then(() => undefined, () => undefined);
  }

  return result;
}

export class TracerfyProvider implements SkipTraceProvider {
  name = "Tracerfy";

  estimateCredits() {
    return 5;
  }

  async runTrace(input: SkipTraceLeadInput): Promise<Record<string, unknown>> {
    const enabled = process.env.TRACERFY_ENABLED?.toLowerCase() === "true";
    const apiKey = process.env.TRACERFY_API_KEY?.trim();
    const baseUrl = process.env.TRACERFY_API_BASE_URL?.trim() || DEFAULT_TRACERFY_API_BASE_URL;

    if (!enabled || !apiKey) {
      return {
        mock: true,
        owner_name: input.owner_name,
        address: input.property_address,
        hit: false,
        persons_count: 0,
        credits_deducted: 0,
        persons: [],
        note: "Tracerfy env is incomplete or disabled. This is a placeholder response.",
      };
    }

    const payload = buildTracerfyLookupPayload(input);
    const response = await fetch(buildTracerfyUrl(baseUrl, "/v1/api/trace/lookup/"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const errorMessage = typeof json.error === "string" ? json.error : `Tracerfy request failed with status ${response.status}.`;
      throw new Error(errorMessage);
    }

    if (typeof json.error === "string" && json.error.trim()) {
      throw new Error(json.error);
    }

    return json;
  }

  normalize(response: Record<string, unknown>) {
    return normalizeTracerfyResponse(response);
  }
}

export async function runSkipTrace(lead: SkipTraceLeadInput) {
  const provider = new TracerfyProvider();
  const raw = await provider.runTrace(lead);
  const normalized = provider.normalize(raw);
  await storeSkipTraceResult(lead, normalized);
  return normalized;
}
