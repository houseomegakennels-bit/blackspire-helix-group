import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { listAllBuyerReports, listSearchJobsByIds } from "@/lib/buyer-engine-server";
import { listDealEngineLeads } from "@/lib/deal-engine-server";
import { listSellerLeads } from "@/lib/seller-engine-server";
import { checkSkipTraceEligibility, runSkipTrace, type SkipTraceLeadInput, type SkipTraceResult } from "@/lib/tracerfy";

export type NexusLeadRecord = {
  id: string;
  owner: string;
  property: string;
  targetType: "seller_lead" | "deal" | "buyer_report";
  sellerScore: number;
  skipTraceStatus: string;
  primaryPhone: string;
  primaryEmail: string;
  confidence: number;
  provider: string;
  lastUpdated: string;
  sourceWorkspace: string;
  actions: Array<"Run Skip Trace" | "View Contact Profile" | "Send to Deal Engine" | "Retry" | "Mark Bad Contact">;
  mailingAddress: string;
  county: string;
  city: string;
  state: string;
  zip: string;
  dossier: string;
  eligibleForAutoTrace: boolean;
};

export type NexusSettings = {
  tracerfyEnabled: boolean;
  minimumSellerScoreForAutoTrace: number;
  manualOverride: boolean;
  creditAlertThreshold: number;
  providerName: string;
  apiKeyConfigured: boolean;
};

export type NexusSnapshot = {
  metrics: Array<{ label: string; value: string; detail: string }>;
  leads: NexusLeadRecord[];
  contacts: NexusLeadRecord[];
  logs: Array<{ id: string; title: string; detail: string; timestamp: string }>;
  settings: NexusSettings;
};

type NexusContactRow = {
  seller_lead_id: string | null;
  owner_name: string;
  property_address: string;
  mailing_address: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  contact_confidence_score: number | null;
  provider: string | null;
  status: string | null;
  updated_at: string;
};

type NexusContactNoteRow = {
  seller_lead_id: string | null;
  note: string;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listStoredNexusContacts() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("nexus_contacts")
    .select("seller_lead_id,owner_name,property_address,mailing_address,primary_phone,primary_email,contact_confidence_score,provider,status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !data?.length) return [];
  return data as NexusContactRow[];
}

function parseNexusContactNote(row: NexusContactNoteRow): NexusContactRow | null {
  const prefix = "NEXUS_CONTACT_RESULT ";
  if (!row.note.startsWith(prefix)) return null;

  try {
    const payload = JSON.parse(row.note.slice(prefix.length)) as Record<string, unknown>;
    const sourceLeadId =
      typeof payload.source_lead_id === "string" && payload.source_lead_id.trim()
        ? payload.source_lead_id.trim()
        : row.seller_lead_id;
    return {
      seller_lead_id: sourceLeadId,
      owner_name: typeof payload.owner_name === "string" ? payload.owner_name : "",
      property_address: typeof payload.property_address === "string" ? payload.property_address : "",
      mailing_address: typeof payload.mailing_address === "string" ? payload.mailing_address : null,
      primary_phone: typeof payload.primary_phone === "string" ? payload.primary_phone : null,
      primary_email: typeof payload.primary_email === "string" ? payload.primary_email : null,
      contact_confidence_score: typeof payload.contact_confidence_score === "number" ? payload.contact_confidence_score : null,
      provider: typeof payload.provider === "string" ? payload.provider : "Tracerfy",
      status: typeof payload.status === "string" ? payload.status : "completed",
      updated_at: typeof payload.completed_at === "string" ? payload.completed_at : row.created_at,
    };
  } catch {
    return null;
  }
}

async function listStoredNexusContactNotes() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("lead_notes")
    .select("seller_lead_id,note,created_at")
    .ilike("note", "NEXUS_CONTACT_RESULT %")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !data?.length) return [];
  const contacts = (data as NexusContactNoteRow[])
    .map(parseNexusContactNote)
    .filter((contact): contact is NexusContactRow => Boolean(contact));

  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key =
      contact.seller_lead_id?.trim()
      || `${normalizeMatch(contact.owner_name)}|${normalizeMatch(contact.property_address)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMatch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanAddressPart(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned && cleaned !== "Unknown" && cleaned !== "Not captured" ? cleaned : "";
}

function formatFullPropertyAddress(street: string, city?: string | null, state?: string | null, zip?: string | null) {
  const streetPart = cleanAddressPart(street);
  if (streetPart.includes(",") && /\b[A-Z]{2}\b/i.test(streetPart)) return streetPart;

  const cityPart = cleanAddressPart(city);
  const statePart = cleanAddressPart(state) || "NC";
  const zipPart = cleanAddressPart(zip);
  const cityStateZip = [cityPart, [statePart, zipPart].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return [streetPart, cityStateZip].filter(Boolean).join(", ");
}

function findStoredContact(contacts: NexusContactRow[], lead: { id: string; owner: string; property: string }) {
  return contacts.find((contact) => contact.seller_lead_id === lead.id)
    ?? contacts.find((contact) =>
      normalizeMatch(contact.owner_name) === normalizeMatch(lead.owner)
      && normalizeMatch(contact.property_address) === normalizeMatch(lead.property)
    )
    ?? null;
}

function applyStoredContact(lead: NexusLeadRecord, contacts: NexusContactRow[]): NexusLeadRecord {
  const contact = findStoredContact(contacts, lead);
  if (!contact) return lead;

  const primaryPhone = contact.primary_phone?.trim() || lead.primaryPhone;
  const primaryEmail = contact.primary_email?.trim() || lead.primaryEmail;
  return {
    ...lead,
    skipTraceStatus: contact.status?.trim() || lead.skipTraceStatus,
    primaryPhone: primaryPhone || "Not captured",
    primaryEmail: primaryEmail || "Not captured",
    confidence: contact.contact_confidence_score ?? lead.confidence,
    provider: contact.provider?.trim() || lead.provider,
    lastUpdated: contact.updated_at || lead.lastUpdated,
    mailingAddress: contact.mailing_address?.trim() || lead.mailingAddress,
  };
}

export async function getNexusSnapshot(): Promise<NexusSnapshot> {
  const [sellerLeads, dealLeads, buyerReportPage, storedContacts, storedContactNotes] = await Promise.all([
    listSellerLeads().catch(() => []),
    listDealEngineLeads(100).catch(() => []),
    listAllBuyerReports({ limit: 120, offset: 0 }).catch(() => ({
      reports: [],
      total: 0,
      limit: 120,
      offset: 0,
    })),
    listStoredNexusContacts().catch(() => []),
    listStoredNexusContactNotes().catch(() => []),
  ]);
  const contactProfiles = [...storedContactNotes, ...storedContacts];
  const buyerJobs = buyerReportPage.reports.length
    ? await listSearchJobsByIds(
        buyerReportPage.reports
          .map((report) => report.search_job_id)
          .filter((id): id is string => Boolean(id)),
      ).catch(() => [])
    : [];
  const buyerJobMap = new Map(
    buyerJobs.map((job) => [
      job.id,
      {
        county: job.county,
        state: job.state,
        propertyType: job.property_type,
      },
    ]),
  );

  const sellerRecords = sellerLeads.map<NexusLeadRecord>((lead) => ({
    id: lead.id,
    owner: lead.ownerName,
    property: formatFullPropertyAddress(lead.propertyAddress, lead.city, lead.state, lead.zipCode),
    targetType: "seller_lead",
    sellerScore: lead.score,
    skipTraceStatus: lead.skipTraceStatus ?? "Queued",
    primaryPhone: lead.ownerPhone ?? "Not captured",
    primaryEmail: lead.ownerEmail ?? "Not captured",
    confidence: lead.contactConfidenceScore ?? (lead.ownerPhone || lead.ownerEmail ? 82 : 0),
    provider: "Tracerfy",
    lastUpdated: lead.importedAt,
    sourceWorkspace: "/seller-engine",
    actions: ["Run Skip Trace", "View Contact Profile", "Send to Deal Engine", "Retry", "Mark Bad Contact"],
    mailingAddress: lead.ownerMailingAddress,
    county: lead.county,
    city: cleanAddressPart(lead.city),
    state: cleanAddressPart(lead.state) || "NC",
    zip: cleanAddressPart(lead.zipCode),
    dossier: lead.summary,
    eligibleForAutoTrace: checkSkipTraceEligibility({ seller_score: lead.score, owner_name: lead.ownerName, property_address: lead.propertyAddress }),
  }));

  const dealRecords = dealLeads
    .filter((lead) => !sellerRecords.some((item) => item.property === lead.propertyAddress))
    .map<NexusLeadRecord>((lead) => ({
      id: lead.id,
      owner: lead.ownerName,
      property: lead.propertyAddress,
      targetType: "deal",
      sellerScore: lead.motivationScore,
      skipTraceStatus: lead.skipTraceStatus ?? "Queued",
      primaryPhone: lead.ownerPhone ?? "Not captured",
      primaryEmail: "Not captured",
      confidence: lead.ownerPhone ? 82 : 0,
      provider: "Tracerfy",
      lastUpdated: nowIso(),
      sourceWorkspace: `/workspace/deal-engine/${encodeURIComponent(lead.id)}`,
      actions: ["Run Skip Trace", "View Contact Profile", "Send to Deal Engine", "Retry", "Mark Bad Contact"],
      mailingAddress: "Not captured",
      county: lead.county,
      city: "",
      state: "NC",
      zip: "",
      dossier: lead.nextAction,
      eligibleForAutoTrace: checkSkipTraceEligibility({ seller_score: lead.motivationScore, owner_name: lead.ownerName, property_address: lead.propertyAddress }),
    }));

  const buyerRecords = buyerReportPage.reports.map<NexusLeadRecord>((report) => {
    const job = report.search_job_id ? buyerJobMap.get(report.search_job_id) ?? null : null;
    const buyerName = report.buyer_name_snapshot?.trim() || "Unknown buyer";
    const mailingAddress = report.mailing_address_snapshot?.trim() || "Not captured";
    const county = job?.county?.trim() || "";
    const state = job?.state?.trim() || "NC";
    const propertyType = job?.propertyType?.replaceAll("_", " ") || "buyer record";
    const score = Number(report.score ?? 0);

    return {
      id: `buyer-report:${report.id}`,
      owner: buyerName,
      property: mailingAddress,
      targetType: "buyer_report",
      sellerScore: score,
      skipTraceStatus: "Queued",
      primaryPhone: "Not captured",
      primaryEmail: "Not captured",
      confidence: 0,
      provider: "Tracerfy",
      lastUpdated: report.created_at,
      sourceWorkspace: report.search_job_id
        ? `/buyers?searchJobId=${encodeURIComponent(report.search_job_id)}`
        : "/buyers",
      actions: ["Run Skip Trace", "View Contact Profile", "Retry", "Mark Bad Contact"],
      mailingAddress,
      county,
      city: "",
      state,
      zip: "",
      dossier: `${buyerName} is a ${report.is_cash_buyer ? "cash" : "tracked"} buyer profile with ${(report.purchase_count ?? 0).toString()} recorded purchases and ${propertyType} focus${county ? ` in ${county} County` : ""}.`,
      eligibleForAutoTrace: mailingAddress !== "Not captured",
    };
  });

  const leads = [...sellerRecords, ...dealRecords, ...buyerRecords].map((lead) => applyStoredContact(lead, contactProfiles));
  const contacts = leads.filter((lead) => lead.primaryPhone !== "Not captured" || lead.primaryEmail !== "Not captured");
  const successfulMatches = leads.filter((lead) => lead.confidence >= 70).length;
  const failedSearches = leads.filter((lead) => /failed|no match/i.test(lead.skipTraceStatus)).length;
  const hotAwaiting = leads.filter((lead) => lead.sellerScore >= 75 && lead.primaryPhone === "Not captured").length;
  const contactReady = leads.filter((lead) => lead.confidence >= 75).length;
  const averageConfidence = leads.length ? Math.round(leads.reduce((sum, lead) => sum + lead.confidence, 0) / leads.length) : 0;

  return {
    metrics: [
      { label: "Available Tracerfy Credits", value: "1000", detail: "Placeholder from your current account until live sync is added." },
      { label: "Skip Traces Completed", value: String(contacts.length).padStart(2, "0"), detail: "Lead records with some contact enrichment resolved." },
      { label: "Successful Matches", value: String(successfulMatches).padStart(2, "0"), detail: "High-confidence contact outcomes ready for operator review." },
      { label: "Failed Searches", value: String(failedSearches).padStart(2, "0"), detail: "Requests that need retry or a secondary provider." },
      { label: "Hot Leads Awaiting Enrichment", value: String(hotAwaiting).padStart(2, "0"), detail: "Leads scoring 75+ that still need contact resolution." },
      { label: "Contact-Ready Leads", value: String(contactReady).padStart(2, "0"), detail: "Leads ready to hand off into Deal Engine outreach." },
      { label: "Average Confidence Score", value: String(averageConfidence), detail: "Average contact confidence across the Nexus queue." },
    ],
    leads,
    contacts,
    logs: leads.slice(0, 8).map((lead, index) => ({
      id: `${lead.id}-${index}`,
      title: `${lead.skipTraceStatus} / ${lead.owner}`,
      detail: `${lead.property} / provider ${lead.provider}`,
      timestamp: lead.lastUpdated,
    })),
    settings: {
      tracerfyEnabled: process.env.TRACERFY_ENABLED?.toLowerCase() === "true",
      minimumSellerScoreForAutoTrace: 75,
      manualOverride: true,
      creditAlertThreshold: 150,
      providerName: "Tracerfy",
      apiKeyConfigured: Boolean(process.env.TRACERFY_API_KEY?.trim()),
    },
  };
}

export async function runNexusSkipTrace(lead: NexusLeadRecord) {
  const input: SkipTraceLeadInput = {
    seller_lead_id: lead.id,
    seller_score: lead.sellerScore,
    owner_name: lead.owner,
    property_address: lead.property,
    mailing_address: lead.mailingAddress,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    county: lead.county,
  };

  const result = await runSkipTrace(input);
  return buildContactStrategy(lead, result);
}

export function buildContactStrategy(lead: NexusLeadRecord, result: SkipTraceResult) {
  const recommendedMethod =
    result.primary_phone && !result.dnc_flag && !result.litigator_flag
      ? "Call between 5 PM and 7 PM, then follow with SMS if compliant."
      : result.primary_phone && (result.dnc_flag || result.litigator_flag)
        ? "Do not cold-call this number. Use a compliant email/manual review lane and confirm consent before any phone outreach."
      : result.primary_email
        ? "Lead with email, then verify whether a compliant call lane exists."
        : "Use manual research or a fallback provider before outreach.";

  return {
    ...result,
    recommendedContactMethod: recommendedMethod,
    aiContactStrategy: `This lead has a seller score of ${lead.sellerScore} and a contact confidence score of ${result.contact_confidence_score}.${result.litigator_flag ? " The matched contact carries a litigator flag." : ""}${result.dnc_flag ? " The primary phone carries a DNC flag." : ""} Recommended first touch: ${recommendedMethod}`,
  };
}

export function getNexusStoredContactProfile(lead: NexusLeadRecord) {
  const primaryPhone = lead.primaryPhone !== "Not captured" ? lead.primaryPhone : null;
  const primaryEmail = lead.primaryEmail !== "Not captured" ? lead.primaryEmail : null;
  const dncFlag = /dnc/i.test(lead.skipTraceStatus) ? true : null;

  return buildContactStrategy(lead, {
    primary_phone: primaryPhone,
    secondary_phone: null,
    additional_phones: [],
    primary_email: primaryEmail,
    additional_emails: [],
    contact_confidence_score: lead.confidence,
    phone_confidence: primaryPhone ? lead.confidence : 0,
    email_confidence: primaryEmail ? lead.confidence : 0,
    dnc_flag: dncFlag,
    litigator_flag: null,
    skip_trace_status: lead.skipTraceStatus,
    skip_trace_provider: lead.provider,
    skip_trace_requested_at: lead.lastUpdated,
    skip_trace_completed_at: lead.lastUpdated,
    raw_skiptrace_response: {
      note: "Stored Nexus contact profile. Run an explicit trace action to refresh from Tracerfy.",
    },
    provider_record_id: null,
    matched_owner_name: lead.owner,
    matched_mailing_address: lead.mailingAddress,
    hit: Boolean(primaryPhone || primaryEmail),
    credits_used: 0,
  });
}
