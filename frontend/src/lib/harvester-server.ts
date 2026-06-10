import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { matchBuyersForProperty, inferNcCountyFromCity } from "@/lib/buyer-engine-server";
import { launchBuyerSearchFromDeal, createDealFromSellerLead } from "@/lib/deal-engine-server";
import { runNexusSkipTrace, type NexusLeadRecord } from "@/lib/nexus-server";
import {
  DEFAULT_SELLER_SCORING_WEIGHTS,
  calculateSellerLeadScore,
  recommendedSellerAction,
  type SellerLiveSourceKey,
} from "@/lib/seller-engine";
import { listSellerLeads } from "@/lib/seller-engine-server";

export const HARVESTER_SOURCE_TYPES = [
  "facebook_group",
  "facebook_marketplace",
  "sms",
  "email",
  "craigslist",
  "wholesaler_site",
  "flyer",
  "pdf",
  "manual",
  "other",
] as const;

export type HarvesterSourceType = (typeof HARVESTER_SOURCE_TYPES)[number];

export type HarvesterIntakeRecord = {
  id: string;
  sourceType: HarvesterSourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  originalText: string | null;
  originalFileUrl: string | null;
  originalFileType: string | null;
  extractedText: string | null;
  extractionStatus: "pending" | "processing" | "extracted" | "approved" | "error";
  extractionConfidence: number;
  classification: string | null;
  createdSellerLeadId: string | null;
  createdDealId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  opportunity?: HarvesterOpportunityRecord | null;
  duplicates?: HarvesterDuplicateRecord[];
  buyerMatches?: HarvesterBuyerMatchRecord[];
};

export type HarvesterOpportunityRecord = {
  id: string;
  intakeId: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  askingPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  occupancyStatus: string | null;
  condition: string | null;
  sellerName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  missingFields: string[];
  confidenceScore: number;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HarvesterDuplicateRecord = {
  id: string;
  intakeId: string;
  matchedIntakeId: string | null;
  matchedSellerLeadId: string | null;
  matchedDealId: string | null;
  duplicateScore: number;
  reasons: string[];
  resolutionStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type HarvesterBuyerMatchRecord = {
  id: string;
  intakeId: string | null;
  opportunityId: string | null;
  buyerId: string | null;
  buyerName: string;
  buyerGroup: string | null;
  matchScore: number;
  reasons: string[];
  recommendedAction: string | null;
  createdAt: string;
};

export type HarvesterMarketplaceEntity = {
  id: string;
  entityName: string;
  entityType: string;
  phone: string | null;
  email: string | null;
  sourceProfiles: Array<Record<string, unknown>>;
  markets: string[];
  averageAskingPrice: number | null;
  postCount: number;
  dealCount: number;
  buyerSignalCount: number;
  reputationScore: number;
  classification: string | null;
  classificationConfidence: number;
  createdAt: string;
  updatedAt: string;
};

export type HarvesterWatchlistRecord = {
  id: string;
  name: string;
  criteria: Record<string, unknown>;
  notifyOnMatch: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HarvesterWorkspaceSnapshot = {
  metrics: Array<{ label: string; value: string; detail: string }>;
  intakes: HarvesterIntakeRecord[];
  extractedDeals: HarvesterOpportunityRecord[];
  entities: HarvesterMarketplaceEntity[];
  buyerMatches: HarvesterBuyerMatchRecord[];
  watchlists: HarvesterWatchlistRecord[];
  alerts: Array<{ id: string; title: string; detail: string; severity: "info" | "warning" | "success" }>;
  tabs: Array<{ id: string; label: string; count: number }>;
  branding: {
    logoPath: string;
    markPath: string;
    logoAvailable: boolean;
    markAvailable: boolean;
  };
};

type HarvesterIntakeInsertInput = {
  sourceType: HarvesterSourceType;
  sourceName?: string;
  sourceUrl?: string;
  originalText?: string;
  originalFileUrl?: string;
  originalFileType?: string;
  propertyAddress?: string;
  county?: string;
  city?: string;
  state?: string;
  zip?: string;
  posterName?: string;
  notes?: string;
};

type ExtractionPayload = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  askingPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  occupancyStatus: string | null;
  condition: string | null;
  sellerName: string | null;
  phone: string | null;
  email: string | null;
  postDate: string | null;
  notes: string | null;
  confidenceScore: number;
  classification: string;
  missingFields: string[];
  rawText: string;
};

type HarvesterIntakeRow = {
  id: string;
  source_type: HarvesterSourceType;
  source_name: string | null;
  source_url: string | null;
  original_text: string | null;
  original_file_url: string | null;
  original_file_type: string | null;
  extracted_text: string | null;
  extraction_status: "pending" | "processing" | "extracted" | "approved" | "error";
  extraction_confidence: number | string | null;
  classification: string | null;
  created_seller_lead_id: string | null;
  created_deal_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type HarvesterOpportunityRow = {
  id: string;
  intake_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  asking_price: number | string | null;
  beds: number | string | null;
  baths: number | string | null;
  sqft: number | null;
  lot_size: number | string | null;
  year_built: number | null;
  occupancy_status: string | null;
  condition: string | null;
  seller_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  raw_payload: Record<string, unknown> | null;
  normalized_payload: Record<string, unknown> | null;
  missing_fields: string[] | null;
  confidence_score: number | string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type HarvesterDuplicateRow = {
  id: string;
  intake_id: string;
  matched_intake_id: string | null;
  matched_seller_lead_id: string | null;
  matched_deal_id: string | null;
  duplicate_score: number | string | null;
  reasons: string[] | null;
  resolution_status: string;
  created_at: string;
  updated_at: string;
};

type HarvesterBuyerMatchRow = {
  id: string;
  intake_id: string | null;
  opportunity_id: string | null;
  buyer_id: string | null;
  buyer_name: string;
  buyer_group: string | null;
  match_score: number | string | null;
  reasons: string[] | null;
  recommended_action: string | null;
  created_at: string;
};

type MarketplaceEntityRow = {
  id: string;
  entity_name: string;
  entity_type: string;
  phone: string | null;
  email: string | null;
  source_profiles: Array<Record<string, unknown>> | null;
  markets: string[] | null;
  average_asking_price: number | string | null;
  post_count: number | null;
  deal_count: number | null;
  buyer_signal_count: number | null;
  reputation_score: number | string | null;
  classification: string | null;
  classification_confidence: number | string | null;
  created_at: string;
  updated_at: string;
};

type WatchlistRow = {
  id: string;
  name: string;
  criteria: Record<string, unknown> | null;
  notify_on_match: boolean;
  created_at: string;
  updated_at: string;
};

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function toNumber(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeAddress(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitAddress(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) {
    return { address: null, city: null, state: null, zip: null };
  }

  const match = text.match(
    /(\d{1,6}\s+[A-Za-z0-9.'#\-\s]+?)(?:,\s*([A-Za-z.\-\s]+))?(?:,\s*([A-Z]{2}))?(?:\s+(\d{5}(?:-\d{4})?))?$/i,
  );

  return {
    address: cleanText(match?.[1] ?? text),
    city: cleanText(match?.[2]),
    state: cleanText(match?.[3])?.toUpperCase() ?? null,
    zip: cleanText(match?.[4]),
  };
}

function detectCondition(text: string) {
  const probes = [
    ["fire damage", /fire damage|smoke damage/i],
    ["tenant occupied", /tenant occupied|rented|occupied/i],
    ["vacant", /vacant|boarded|empty/i],
    ["light rehab", /light rehab|cosmetic|minor rehab/i],
    ["heavy rehab", /full gut|heavy rehab|needs work|tlc/i],
    ["turnkey", /turnkey|move[- ]in ready|fully renovated/i],
  ] as const;

  return probes.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function classifyOpportunity(text: string, sourceType: HarvesterSourceType) {
  if (/cash buyer|looking to buy|hedge fund|buy box/i.test(text)) return "buyer_demand";
  if (/assignable|wholesale deal|arv|asking|obo|emd|proof of funds/i.test(text)) return "wholesaler_inventory";
  if (/owner financing|tired landlord|inherited|vacant|probate|foreclosure/i.test(text)) return "seller_opportunity";
  if (sourceType === "facebook_group" || sourceType === "facebook_marketplace") return "wholesaler_inventory";
  return "unclear";
}

function parseExtraction(text: string, metadata: Record<string, unknown> = {}): ExtractionPayload {
  const seededAddress = cleanText(metadata.propertyAddress);
  const seededCity = cleanText(metadata.city);
  const seededState = cleanText(metadata.state)?.toUpperCase() ?? null;
  const seededZip = cleanText(metadata.zip);
  const seededCounty = cleanText(metadata.county);
  const seededSeller = cleanText(metadata.posterName);

  const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] ?? null;
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const money = text.match(/\$?\s?(\d{2,3}(?:,\d{3})+(?:\.\d{2})?|\d{4,7})(?!\s*(?:sq|sf))/i)?.[1] ?? null;
  const beds = text.match(/(\d+(?:\.\d+)?)\s*(?:bed|beds|br)\b/i)?.[1] ?? null;
  const baths = text.match(/(\d+(?:\.\d+)?)\s*(?:bath|baths|ba)\b/i)?.[1] ?? null;
  const sqft = text.match(/(\d{3,5})\s*(?:sq\.?\s*ft|sqft|sf)\b/i)?.[1] ?? null;
  const lotSize = text.match(/(\d+(?:\.\d+)?)\s*(?:acre|acres|lot)\b/i)?.[1] ?? null;
  const yearBuilt = text.match(/\b(?:built|year built)\s*(?:in\s*)?(\d{4})\b/i)?.[1] ?? null;
  const addressMatch =
    text.match(/\d{1,6}\s+[A-Za-z0-9.'#\-\s]+,\s*[A-Za-z.\-\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/i)?.[0]
    ?? text.match(/\d{1,6}\s+[A-Za-z0-9.'#\-\s]+/i)?.[0]
    ?? seededAddress;
  const addressParts = splitAddress(addressMatch);
  const countyMatch = text.match(/\b([A-Za-z.\-\s]+?)\s+county\b/i)?.[1] ?? seededCounty;
  const occupancyStatus = /vacant|empty|tenant occupied|owner occupied|absentee/i.test(text)
    ? text.match(/vacant|empty|tenant occupied|owner occupied|absentee/i)?.[0] ?? null
    : null;
  const condition = detectCondition(text);
  const postDate = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i)?.[0] ?? null;
  const notes = cleanText(metadata.notes) ?? cleanText(text.slice(0, 600));
  const missingFields = [
    !addressParts.address && "address",
    !addressParts.city && !seededCity && "city",
    !addressParts.state && !seededState && "state",
    !money && "asking_price",
    !phone && "phone",
    !email && "email",
  ].filter((value): value is string => Boolean(value));

  const fieldCount = [
    addressParts.address ?? seededAddress,
    addressParts.city ?? seededCity,
    addressParts.state ?? seededState,
    addressParts.zip ?? seededZip,
    countyMatch,
    money,
    beds,
    baths,
    sqft,
    yearBuilt,
    occupancyStatus,
    condition,
    seededSeller,
    phone,
    email,
  ].filter(Boolean).length;
  const confidenceScore = Math.min(98, Math.max(28, Math.round((fieldCount / 15) * 100)));

  return {
    address: addressParts.address ?? seededAddress,
    city: addressParts.city ?? seededCity,
    state: addressParts.state ?? seededState ?? "NC",
    zip: addressParts.zip ?? seededZip,
    county: cleanText(countyMatch),
    askingPrice: toNumber(money),
    beds: toNumber(beds),
    baths: toNumber(baths),
    sqft: toNumber(sqft),
    lotSize: toNumber(lotSize),
    yearBuilt: toNumber(yearBuilt),
    occupancyStatus,
    condition,
    sellerName: seededSeller,
    phone,
    email,
    postDate,
    notes,
    confidenceScore,
    classification: classifyOpportunity(text, (metadata.sourceType as HarvesterSourceType | undefined) ?? "other"),
    missingFields,
    rawText: text,
  };
}

async function extractWithAi(text: string, metadata: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const instructions =
    "You extract structured wholesale real-estate opportunity fields from a post, listing, SMS, email, flyer, or OCR transcript. " +
    "Return ONLY a valid JSON object (no markdown fences, no commentary) with EXACTLY these keys: " +
    "address, city, state, zip, county, askingPrice, beds, baths, sqft, lotSize, yearBuilt, occupancyStatus, condition, sellerName, phone, email, postDate, notes, classification. " +
    "Rules: 'address' is the street address ONLY (e.g. '1418 Maple Grove Rd'), never a bed/bath count or city. " +
    "'askingPrice' is the seller's asking price as a plain number with no commas or currency symbol — it is NEVER a ZIP code, ARV, or square footage. " +
    "'sqft' is living area as a plain number (strip commas, so '1,540' becomes 1540). " +
    "'zip' is the 5-digit US postal code — always extract it even when it appears at the end of an address line such as 'Fayetteville, NC, 28301'. " +
    "'city' and 'county' are place names. Use null for anything not present. Numbers must be JSON numbers, not strings. " +
    "'sellerName' is the person to contact: use the explicit seller/contact name if given, otherwise use the post's author / 'Posted by' name. " +
    "'phone' and 'email' must be pulled from ANYWHERE in the content — the body, a 'call/text' line, a signature, or contact instructions. Normalize phone to digits and dashes. Return null only if truly absent. " +
    "'classification' is one of: wholesaler_inventory, fsbo, agent_listing, lead, unclear. " +
    "'notes' is a one or two sentence summary of the opportunity that also mentions ARV, rehab estimate, and any condition flags (roof, HVAC, etc.) when present.";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: instructions },
        { role: "user", content: JSON.stringify({ text, metadata }) },
      ],
      max_output_tokens: 700,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { output_text?: string; output?: unknown };
  const raw = getResponseOutputText(payload).trim();
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const toNum = (value: unknown): number | null => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const n = Number(value.replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  };
  const toStr = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  try {
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as Record<string, unknown>;
    return {
      address: toStr(parsed.address),
      city: toStr(parsed.city),
      state: toStr(parsed.state),
      zip: toStr(parsed.zip),
      county: toStr(parsed.county),
      askingPrice: toNum(parsed.askingPrice),
      beds: toNum(parsed.beds),
      baths: toNum(parsed.baths),
      sqft: toNum(parsed.sqft),
      lotSize: toNum(parsed.lotSize),
      yearBuilt: toNum(parsed.yearBuilt),
      occupancyStatus: toStr(parsed.occupancyStatus),
      condition: toStr(parsed.condition),
      sellerName: toStr(parsed.sellerName),
      phone: toStr(parsed.phone),
      email: toStr(parsed.email),
      postDate: toStr(parsed.postDate),
      notes: toStr(parsed.notes),
      classification: toStr(parsed.classification) ?? "unclear",
    } as Omit<ExtractionPayload, "confidenceScore" | "missingFields" | "rawText">;
  } catch {
    return null;
  }
}

// Pull plain text out of a /v1/responses payload regardless of whether the model
// returned the convenience `output_text` field or the structured `output` array.
function getResponseOutputText(response: { output_text?: string; output?: unknown }): string {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const t = (part as { text?: unknown }).text;
      if (typeof t === "string") return t;
    }
  }
  return "";
}

// Vision OCR: transcribe a screenshot / flyer image into raw post text so the
// existing text-extraction pipeline (parseExtraction + extractWithAi) can run.
// Accepts a base64 data URL or an http(s) image URL.
async function ocrImageWithAi(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!/^(data:image\/|https?:\/\/)/i.test(imageUrl)) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "This image is a screenshot of a real-estate post, listing, marketplace ad, flyer, text message, or email about a property. Read the ENTIRE image top to bottom and transcribe ALL readable text verbatim. Be exhaustive — do not skip anything. Specifically capture: " +
                "(1) the POSTER'S NAME or profile/display name at the very top of the post or message (this is the seller/wholesaler contact — always include it, on its own line, prefixed with 'Posted by: '); " +
                "(2) the Facebook group name, page name, or source heading if shown; " +
                "(3) the post date/time if shown; " +
                "(4) every property detail: price/asking price, ARV, rehab estimate, address, city, county, state, ZIP, beds/baths, square footage, lot size, year built, condition, occupancy, access; " +
                "(5) ANY phone number, email address, website, or contact instruction anywhere in the image — including inside the post body, captions, image overlays, watermarks, or comments. Look carefully for phone numbers in formats like 910-555-0123, (910) 555-0123, or 9105550123, and for emails. " +
                "Preserve every number, name, and contact string exactly as shown. Output only the transcribed text with no commentary. If the image contains no readable property information, output the single word NONE.",
            },
            { type: "input_image", image_url: imageUrl, detail: "high" },
          ],
        },
      ],
      max_output_tokens: 1200,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { output_text?: string; output?: unknown };
  const text = getResponseOutputText(payload).trim();
  if (!text || text.toUpperCase() === "NONE") return null;
  return text;
}

function mapOpportunity(row: HarvesterOpportunityRow): HarvesterOpportunityRecord {
  return {
    id: row.id,
    intakeId: row.intake_id,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: row.county,
    askingPrice: toNumber(row.asking_price),
    beds: toNumber(row.beds),
    baths: toNumber(row.baths),
    sqft: row.sqft,
    lotSize: toNumber(row.lot_size),
    yearBuilt: row.year_built,
    occupancyStatus: row.occupancy_status,
    condition: row.condition,
    sellerName: row.seller_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    rawPayload: row.raw_payload ?? {},
    normalizedPayload: row.normalized_payload ?? {},
    missingFields: row.missing_fields ?? [],
    confidenceScore: toNumber(row.confidence_score) ?? 0,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIntake(row: HarvesterIntakeRow): HarvesterIntakeRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    originalText: row.original_text,
    originalFileUrl: row.original_file_url,
    originalFileType: row.original_file_type,
    extractedText: row.extracted_text,
    extractionStatus: row.extraction_status,
    extractionConfidence: toNumber(row.extraction_confidence) ?? 0,
    classification: row.classification,
    createdSellerLeadId: row.created_seller_lead_id,
    createdDealId: row.created_deal_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDuplicate(row: HarvesterDuplicateRow): HarvesterDuplicateRecord {
  return {
    id: row.id,
    intakeId: row.intake_id,
    matchedIntakeId: row.matched_intake_id,
    matchedSellerLeadId: row.matched_seller_lead_id,
    matchedDealId: row.matched_deal_id,
    duplicateScore: toNumber(row.duplicate_score) ?? 0,
    reasons: row.reasons ?? [],
    resolutionStatus: row.resolution_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBuyerMatch(row: HarvesterBuyerMatchRow): HarvesterBuyerMatchRecord {
  return {
    id: row.id,
    intakeId: row.intake_id,
    opportunityId: row.opportunity_id,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    buyerGroup: row.buyer_group,
    matchScore: toNumber(row.match_score) ?? 0,
    reasons: row.reasons ?? [],
    recommendedAction: row.recommended_action,
    createdAt: row.created_at,
  };
}

function mapEntity(row: MarketplaceEntityRow): HarvesterMarketplaceEntity {
  return {
    id: row.id,
    entityName: row.entity_name,
    entityType: row.entity_type,
    phone: row.phone,
    email: row.email,
    sourceProfiles: row.source_profiles ?? [],
    markets: row.markets ?? [],
    averageAskingPrice: toNumber(row.average_asking_price),
    postCount: row.post_count ?? 0,
    dealCount: row.deal_count ?? 0,
    buyerSignalCount: row.buyer_signal_count ?? 0,
    reputationScore: toNumber(row.reputation_score) ?? 0,
    classification: row.classification,
    classificationConfidence: toNumber(row.classification_confidence) ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWatchlist(row: WatchlistRow): HarvesterWatchlistRecord {
  return {
    id: row.id,
    name: row.name,
    criteria: row.criteria ?? {},
    notifyOnMatch: row.notify_on_match,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getHarvesterBranding() {
  // The official Harvester logo is committed under public/logos and is always
  // served from the CDN. We intentionally do NOT use existsSync here: public/ is
  // uploaded to Vercel's CDN rather than bundled into the serverless function, so
  // existsSync can read false at runtime and wrongly hide the real asset.
  return {
    logoPath: "/logos/harvester-logo.png",
    markPath: "/logos/harvester-mark.png",
    logoAvailable: true,
    markAvailable: true,
  };
}

function getDemoSnapshot(): HarvesterWorkspaceSnapshot {
  const branding = getHarvesterBranding();
  const now = new Date().toISOString();
  const intakeId = "demo-intake-1";
  const opportunityId = "demo-opportunity-1";
  const intakes: HarvesterIntakeRecord[] = [
    {
      id: intakeId,
      sourceType: "facebook_group",
      sourceName: "NC Wholesale Property Network",
      sourceUrl: "https://example.com/post/1",
      originalText:
        "3/2 brick ranch in Fayetteville NC. Asking 119k. Needs light rehab. Vacant. Call Marcus at 910-555-0198.",
      originalFileUrl: null,
      originalFileType: null,
      extractedText: "Structured opportunity extracted from pasted post text.",
      extractionStatus: "approved",
      extractionConfidence: 86,
      classification: "wholesaler_inventory",
      createdSellerLeadId: null,
      createdDealId: null,
      metadata: { sourceGroup: "NC Wholesale Property Network", posterName: "Marcus" },
      createdAt: now,
      updatedAt: now,
      duplicates: [],
      buyerMatches: [],
    },
  ];
  const extractedDeals: HarvesterOpportunityRecord[] = [
    {
      id: opportunityId,
      intakeId,
      address: "421 Branson Street",
      city: "Fayetteville",
      state: "NC",
      zip: "28301",
      county: "Cumberland",
      askingPrice: 119000,
      beds: 3,
      baths: 2,
      sqft: 1420,
      lotSize: null,
      yearBuilt: null,
      occupancyStatus: "vacant",
      condition: "light rehab",
      sellerName: "Marcus",
      phone: "910-555-0198",
      email: null,
      notes: "Pasted post intake. Good wholesale positioning but operator should verify the actual seller relationship.",
      rawPayload: {},
      normalizedPayload: {},
      missingFields: ["year_built", "email"],
      confidenceScore: 86,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  intakes[0].opportunity = extractedDeals[0];

  return {
    metrics: [
      { label: "Total Intakes", value: "01", detail: "Opportunity captures waiting for extraction or operator review." },
      { label: "Opportunities Extracted", value: "01", detail: "Structured records built from text, screenshots, or flyers." },
      { label: "Seller Leads Created", value: "00", detail: "Approved Harvester records that have been pushed into Seller Engine." },
      { label: "Deals Created", value: "00", detail: "Harvester opportunities handed into Deal Engine." },
      { label: "Buyer Matches Found", value: "00", detail: "Potential buyer-group matches ranked for the opportunity queue." },
      { label: "Duplicate Alerts", value: "00", detail: "Potential repeat listings or recycled opportunities." },
      { label: "Watchlist Hits", value: "00", detail: "Incoming opportunities that match marketplace watchlists." },
    ],
    intakes,
    extractedDeals,
    entities: [],
    buyerMatches: [],
    watchlists: [],
    alerts: [
      {
        id: "demo-alert-1",
        title: "AI vision OCR is live",
        detail: "Upload a screenshot or flyer image and Harvester reads it automatically with AI vision OCR, then extracts structured deal fields. PDFs store metadata only for now.",
        severity: "info",
      },
    ],
    tabs: [
      { id: "intake", label: "Intake", count: intakes.length },
      { id: "deals", label: "Extracted Deals", count: extractedDeals.length },
      { id: "intelligence", label: "Marketplace Intelligence", count: 0 },
      { id: "profiles", label: "Poster Profiles", count: 0 },
      { id: "buyers", label: "Buyer Signals", count: 0 },
      { id: "watchlists", label: "Watchlists", count: 0 },
      { id: "settings", label: "Settings", count: 1 },
    ],
    branding,
  };
}

async function ensureDefaultWatchlist(supabase: SupabaseClient) {
  const { data } = await supabase.from("harvester_watchlists").select("id").limit(1);
  if (data?.length) return;
  await supabase.from("harvester_watchlists").insert({
    name: "NC Value Buy Box",
    criteria: {
      targetCounties: ["Wake", "Mecklenburg", "Forsyth", "Cumberland", "Guilford"],
      maxPrice: 250000,
      propertyType: ["single family", "duplex", "townhome"],
      sourceTypes: ["facebook_group", "facebook_marketplace", "sms", "email"],
    },
    notify_on_match: true,
  });
}

export async function listHarvesterIntakes(limit = 50): Promise<HarvesterIntakeRecord[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return getDemoSnapshot().intakes;

  await ensureDefaultWatchlist(supabase);

  const [{ data: intakeRows }, { data: opportunityRows }, { data: duplicateRows }, { data: buyerMatchRows }] = await Promise.all([
    supabase.from("harvester_intakes").select("*").order("created_at", { ascending: false }).limit(limit),
    supabase.from("harvester_extracted_opportunities").select("*").order("created_at", { ascending: false }).limit(limit),
    supabase.from("harvester_duplicates").select("*").order("created_at", { ascending: false }).limit(limit),
    supabase.from("harvester_buyer_matches").select("*").order("created_at", { ascending: false }).limit(limit * 3),
  ]);

  const opportunitiesByIntake = new Map(
    ((opportunityRows ?? []) as HarvesterOpportunityRow[]).map((row) => [row.intake_id, mapOpportunity(row)]),
  );
  const duplicatesByIntake = new Map<string, HarvesterDuplicateRecord[]>();
  for (const row of (duplicateRows ?? []) as HarvesterDuplicateRow[]) {
    const mapped = mapDuplicate(row);
    duplicatesByIntake.set(mapped.intakeId, [...(duplicatesByIntake.get(mapped.intakeId) ?? []), mapped]);
  }
  const matchesByIntake = new Map<string, HarvesterBuyerMatchRecord[]>();
  for (const row of (buyerMatchRows ?? []) as HarvesterBuyerMatchRow[]) {
    const mapped = mapBuyerMatch(row);
    if (!mapped.intakeId) continue;
    matchesByIntake.set(mapped.intakeId, [...(matchesByIntake.get(mapped.intakeId) ?? []), mapped]);
  }

  return ((intakeRows ?? []) as HarvesterIntakeRow[]).map((row) => ({
    ...mapIntake(row),
    opportunity: opportunitiesByIntake.get(row.id) ?? null,
    duplicates: duplicatesByIntake.get(row.id) ?? [],
    buyerMatches: matchesByIntake.get(row.id) ?? [],
  }));
}

export async function getHarvesterIntakeDetail(intakeId: string) {
  const rows = await listHarvesterIntakes(200);
  return rows.find((row) => row.id === intakeId) ?? null;
}

export async function createHarvesterIntake(input: HarvesterIntakeInsertInput) {
  const supabase = getSupabaseAdmin();
  const metadata = {
    propertyAddress: cleanText(input.propertyAddress),
    county: cleanText(input.county),
    city: cleanText(input.city),
    state: cleanText(input.state)?.toUpperCase() ?? "NC",
    zip: cleanText(input.zip),
    posterName: cleanText(input.posterName),
    notes: cleanText(input.notes),
    sourceType: input.sourceType,
  };

  if (!supabase) {
    return {
      ok: true as const,
      intake: getDemoSnapshot().intakes[0],
      storageMode: "demo",
    };
  }

  const { data, error } = await supabase
    .from("harvester_intakes")
    .insert({
      source_type: input.sourceType,
      source_name: cleanText(input.sourceName),
      source_url: cleanText(input.sourceUrl),
      original_text: cleanText(input.originalText),
      original_file_url: cleanText(input.originalFileUrl),
      original_file_type: cleanText(input.originalFileType),
      extraction_status: "pending",
      extraction_confidence: 0,
      metadata,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return {
    ok: true as const,
    intake: mapIntake(data as HarvesterIntakeRow),
    storageMode: "supabase",
  };
}

// Delete a Harvester intake and everything that hangs off it (extracted
// opportunity, duplicate/watchlist matches, buyer matches). Downstream Seller
// Engine / Deal Engine records are intentionally left in place — removing an
// intake should never silently delete a lead or deal already in the pipeline.
export async function deleteHarvesterIntake(intakeId: string) {
  const cleanId = intakeId?.trim();
  if (!cleanId) throw new Error("An intake id is required to delete a Harvester intake.");

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: true as const, intakeId: cleanId, storageMode: "demo" as const };
  }

  const { data: opportunity } = await supabase
    .from("harvester_extracted_opportunities")
    .select("id")
    .eq("intake_id", cleanId)
    .maybeSingle();

  await supabase.from("harvester_buyer_matches").delete().eq("intake_id", cleanId);
  await supabase.from("harvester_duplicates").delete().eq("intake_id", cleanId);
  await supabase.from("harvester_duplicates").delete().eq("matched_intake_id", cleanId);
  await supabase.from("harvester_watchlist_matches").delete().eq("intake_id", cleanId);
  if (opportunity?.id) {
    await supabase.from("harvester_watchlist_matches").delete().eq("opportunity_id", opportunity.id);
  }
  await supabase.from("harvester_extracted_opportunities").delete().eq("intake_id", cleanId);

  const { error } = await supabase.from("harvester_intakes").delete().eq("id", cleanId);
  if (error) throw new Error(error.message);

  return { ok: true as const, intakeId: cleanId, storageMode: "supabase" as const };
}

export async function extractHarvesterOpportunity(input: {
  intakeId?: string;
  originalText?: string;
  imageDataUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const intake = input.intakeId ? await getHarvesterIntakeDetail(input.intakeId) : null;
  let text = cleanText(input.originalText) ?? intake?.originalText ?? intake?.extractedText ?? "";
  const metadata = {
    ...(intake?.metadata ?? {}),
    ...(input.metadata ?? {}),
    sourceType: intake?.sourceType ?? input.metadata?.sourceType ?? "other",
  };

  // No pasted text? Try vision OCR on an uploaded image (screenshot / flyer).
  if (!text) {
    const storedFile = intake?.originalFileUrl;
    const imageSource =
      input.imageDataUrl?.trim() ||
      (storedFile && /^(data:image\/|https?:\/\/)/i.test(storedFile) ? storedFile : null);
    if (imageSource) {
      const ocrText = await ocrImageWithAi(imageSource).catch(() => null);
      if (ocrText) text = ocrText;
    }
  }

  if (!text) {
    throw new Error(
      "Harvester could not read this intake. Paste the post text, or upload a clearer screenshot/flyer image (image OCR requires OPENAI_API_KEY to be configured).",
    );
  }

  const heuristic = parseExtraction(text, metadata);
  const aiExtraction = await extractWithAi(text, metadata).catch(() => null);
  // Let the AI win for every field it actually extracted, but never let an AI
  // null/empty clobber a value the heuristic already found — backfill instead.
  const aiClean = aiExtraction
    ? (Object.fromEntries(
        Object.entries(aiExtraction).filter(([, value]) => value !== null && value !== undefined && value !== ""),
      ) as Partial<typeof aiExtraction>)
    : {};
  const payload = aiExtraction
    ? {
        ...heuristic,
        ...aiClean,
        confidenceScore: Math.min(99, heuristic.confidenceScore + 6),
        missingFields: heuristic.missingFields.filter((field) => !aiExtraction[field as keyof typeof aiExtraction]),
        rawText: text,
      }
    : heuristic;

  // Deterministic ZIP backfill: a 5-digit code that follows a 2-letter state
  // (e.g. "Fayetteville, NC, 28301"). Anchored to the state so it won't grab an
  // unrelated 5-digit number like a lot size or square footage.
  if (!payload.zip) {
    const zipMatch = text.match(/\b[A-Z]{2}\s*,?\s*(\d{5})(?:-\d{4})?\b/);
    if (zipMatch) payload.zip = zipMatch[1];
  }

  // County backfill: infer the NC county from the city when extraction left it
  // blank/Unknown, so the property record and buyer matching have a real county.
  const countyBlank = !payload.county || /^(unknown|unresolved|n\/a)$/i.test(payload.county.trim());
  if (countyBlank && payload.city) {
    const inferredCounty = inferNcCountyFromCity(payload.city);
    if (inferredCounty) payload.county = inferredCounty;
  }

  if (!supabase || !input.intakeId) {
    return {
      ok: true as const,
      extraction: payload,
      storageMode: supabase ? "ephemeral" : "demo",
    };
  }

  await supabase
    .from("harvester_intakes")
    .update({
      extracted_text: payload.rawText ?? text,
      extraction_status: "extracted",
      extraction_confidence: payload.confidenceScore,
      classification: payload.classification,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.intakeId);

  const { data, error } = await supabase
    .from("harvester_extracted_opportunities")
    .upsert({
      intake_id: input.intakeId,
      address: payload.address,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      county: payload.county,
      asking_price: payload.askingPrice,
      beds: payload.beds,
      baths: payload.baths,
      sqft: payload.sqft,
      lot_size: payload.lotSize,
      year_built: payload.yearBuilt,
      occupancy_status: payload.occupancyStatus,
      condition: payload.condition,
      seller_name: payload.sellerName,
      phone: payload.phone,
      email: payload.email,
      notes: payload.notes,
      raw_payload: { metadata, text, postDate: payload.postDate },
      normalized_payload: {
        address: payload.address,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        county: payload.county,
        askingPrice: payload.askingPrice,
        beds: payload.beds,
        baths: payload.baths,
        sqft: payload.sqft,
      },
      missing_fields: payload.missingFields,
      confidence_score: payload.confidenceScore,
      updated_at: new Date().toISOString(),
    }, { onConflict: "intake_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return {
    ok: true as const,
    extraction: mapOpportunity(data as HarvesterOpportunityRow),
    storageMode: "supabase",
  };
}

function buildMotivationSignals(opportunity: HarvesterOpportunityRecord, intake: HarvesterIntakeRecord) {
  const lowerNotes = `${opportunity.notes ?? ""} ${intake.originalText ?? ""}`.toLowerCase();
  return {
    absenteeOwner: /absentee|non.?owner|mail away|landlord/i.test(lowerNotes),
    yearsOwned: /legacy|long[- ]time owner/i.test(lowerNotes) ? 12 : 0,
    taxDelinquent: /tax delinquent|delinquent/i.test(lowerNotes),
    foreclosure: /foreclosure|auction/i.test(lowerNotes),
    probate: /probate|estate/i.test(lowerNotes),
    vacant: /vacant|empty/i.test(`${opportunity.occupancyStatus ?? ""} ${lowerNotes}`),
    codeViolation: /code violation|condemned|boarded/i.test(lowerNotes),
    estimatedEquity: opportunity.askingPrice ? Math.round(opportunity.askingPrice * 0.38) : null,
    assessedValue: opportunity.askingPrice ? Math.round(opportunity.askingPrice * 0.92) : null,
    multipleProperties: /portfolio|multiple doors|llc/i.test(lowerNotes),
    outOfStateOwner: /\b(sc|ga|va|fl|tx)\b/i.test(lowerNotes),
  };
}

async function persistSellerLeadFromHarvester(
  supabase: SupabaseClient,
  intake: HarvesterIntakeRecord,
  opportunity: HarvesterOpportunityRecord,
) {
  const ownerMailingAddress = intake.sourceUrl || opportunity.address || "Harvester intake";
  const ownerName = opportunity.sellerName || (intake.metadata.posterName as string | undefined) || "Unknown poster";
  const propertyState = opportunity.state || "NC";

  const { data: owner, error: ownerError } = await supabase
    .from("owners")
    .insert({
      name: ownerName,
      mailing_address: ownerMailingAddress,
      mailing_city: opportunity.city,
      mailing_state: propertyState,
      mailing_zip: opportunity.zip,
    })
    .select("id")
    .single();
  if (ownerError) throw new Error(ownerError.message);

  // Find-or-create the data source. (data_sources has no unique(name,county,state)
  // constraint in production and contains legacy duplicates, so we can't upsert.)
  const harvesterSourceName = intake.sourceName || "Harvester Intake";
  let dataSourceId: string;
  {
    let findSource = supabase
      .from("data_sources")
      .select("id")
      .eq("name", harvesterSourceName)
      .eq("state", propertyState)
      .eq("integration_type", "harvester_intake");
    if (opportunity.county) findSource = findSource.eq("county", opportunity.county);
    const { data: existingSource } = await findSource.limit(1).maybeSingle();

    if (existingSource) {
      dataSourceId = existingSource.id as string;
    } else {
      const { data: newSource, error: sourceError } = await supabase
        .from("data_sources")
        .insert({
          name: harvesterSourceName,
          source_type: "blended_search",
          county: opportunity.county,
          state: propertyState,
          source_url: intake.sourceUrl,
          integration_type: "harvester_intake",
          active: true,
          configuration: {
            harvesterIntakeId: intake.id,
            sourceType: intake.sourceType,
            extractionConfidence: intake.extractionConfidence,
          },
        })
        .select("id")
        .single();
      if (sourceError) throw new Error(sourceError.message);
      dataSourceId = newSource.id as string;
    }
  }

  const signals = buildMotivationSignals(opportunity, intake);
  const score = calculateSellerLeadScore(signals, DEFAULT_SELLER_SCORING_WEIGHTS);
  const recommendedAction = recommendedSellerAction(score.score, score.reasons);

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .insert({
      owner_id: owner.id,
      data_source_id: dataSourceId,
      property_address: opportunity.address || "Unknown property",
      county: opportunity.county,
      city: opportunity.city,
      state: propertyState,
      zip_code: opportunity.zip,
      property_type: opportunity.beds && opportunity.baths ? "Single Family" : "Unknown",
      assessed_value: signals.assessedValue,
      owner_occupancy_status: opportunity.occupancyStatus,
      tax_delinquent: signals.taxDelinquent,
      foreclosure: signals.foreclosure,
      probate: signals.probate,
      vacant: signals.vacant,
      code_violation: signals.codeViolation,
      years_owned: signals.yearsOwned,
      estimated_equity: signals.estimatedEquity,
      raw_source_data: {
        harvesterIntakeId: intake.id,
        opportunityId: opportunity.id,
        sourceType: intake.sourceType,
      },
    })
    .select("id")
    .single();
  if (propertyError) throw new Error(propertyError.message);

  const { data: lead, error: leadError } = await supabase
    .from("seller_leads")
    .upsert({
      property_id: property.id,
      owner_id: owner.id,
      motivation_score: score.score,
      lead_category: score.category,
      motivation_reasons: [
        ...score.reasons,
        `Harvester classification: ${intake.classification ?? "unclear"}`,
        `Harvester confidence: ${Math.round(opportunity.confidenceScore)}%`,
      ],
      recommended_action: recommendedAction,
      ai_summary: `Imported from Harvester. ${ownerName} / ${opportunity.address ?? "Unknown property"} surfaced through ${intake.sourceType.replaceAll("_", " ")} with ${Math.round(opportunity.confidenceScore)}% extraction confidence.`,
    }, { onConflict: "property_id" })
    .select("id")
    .single();
  if (leadError) throw new Error(leadError.message);

  await supabase.from("lead_scores").insert({
    seller_lead_id: lead.id,
    score: score.score,
    category: score.category,
    reasons: score.reasons,
    weights_snapshot: DEFAULT_SELLER_SCORING_WEIGHTS,
  });

  await supabase.from("lead_notes").insert({
    seller_lead_id: lead.id,
    note: [
      `HARVESTER_IMPORT / intake ${intake.id}`,
      `Source: ${intake.sourceType}${intake.sourceName ? ` / ${intake.sourceName}` : ""}.`,
      `Classification: ${intake.classification ?? "unclear"}.`,
      `Extraction confidence: ${Math.round(opportunity.confidenceScore)}%.`,
      opportunity.notes ?? "",
    ].join(" "),
  });

  await supabase
    .from("harvester_intakes")
    .update({
      created_seller_lead_id: lead.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intake.id);

  return {
    sellerLeadId: lead.id as string,
    score,
  };
}

export async function approveHarvesterExtraction(input: { intakeId: string }) {
  const supabase = getSupabaseAdmin();
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake?.opportunity) throw new Error("The Harvester intake does not have an extracted opportunity yet.");

  if (!supabase) {
    return {
      ok: true as const,
      intakeId: input.intakeId,
      opportunityId: intake.opportunity.id,
      duplicateCheck: { duplicates: [] },
      watchlistMatches: [],
      storageMode: "demo",
    };
  }

  await supabase
    .from("harvester_extracted_opportunities")
    .update({
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", intake.opportunity.id);

  await supabase
    .from("harvester_intakes")
    .update({
      extraction_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", intake.id);

  const duplicateCheck = await detectDuplicateHarvesterDeal({ intakeId: intake.id, persist: true });
  const watchlistMatches = await matchHarvesterWatchlists(intake.opportunity, intake.id);

  return {
    ok: true as const,
    intakeId: intake.id,
    opportunityId: intake.opportunity.id,
    duplicateCheck,
    watchlistMatches,
    storageMode: "supabase",
  };
}

export async function createSellerLeadFromHarvester(input: { intakeId: string }) {
  const supabase = getSupabaseAdmin();
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake?.opportunity) throw new Error("Run extraction before sending this intake to Seller Engine.");

  if (intake.createdSellerLeadId) {
    return {
      ok: true as const,
      sellerLeadId: intake.createdSellerLeadId,
      created: false,
      nexusStatus: "ready",
      storageMode: supabase ? "supabase" : "demo",
    };
  }

  if (!supabase) {
    return {
      ok: true as const,
      sellerLeadId: "demo-seller-lead",
      created: true,
      nexusStatus: "placeholder",
      storageMode: "demo",
    };
  }

  const result = await persistSellerLeadFromHarvester(supabase, intake, intake.opportunity);
  return {
    ok: true as const,
    sellerLeadId: result.sellerLeadId,
    created: true,
    nexusStatus: intake.opportunity.phone || intake.opportunity.email ? "contact-captured" : "ready-for-skip-trace",
    storageMode: "supabase",
  };
}

export async function runHarvesterNexusEnrichment(input: { intakeId: string }) {
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake?.opportunity) throw new Error("No extracted opportunity is attached to this intake.");
  const sellerLeadId = intake.createdSellerLeadId ?? (await createSellerLeadFromHarvester({ intakeId: input.intakeId })).sellerLeadId;
  const sellerLead = (await listSellerLeads()).find((lead) => lead.id === sellerLeadId);
  if (!sellerLead) {
    return {
      ok: true as const,
      status: "queued",
      detail: "Seller lead was created, but Nexus enrichment is waiting for the lead to appear in the live queue.",
    };
  }

  const nexusLead: NexusLeadRecord = {
    id: sellerLead.id,
    owner: sellerLead.ownerName,
    property: sellerLead.propertyAddress,
    targetType: "seller_lead",
    sellerScore: sellerLead.score,
    skipTraceStatus: sellerLead.skipTraceStatus ?? "Queued",
    primaryPhone: sellerLead.ownerPhone ?? "Not captured",
    primaryEmail: sellerLead.ownerEmail ?? "Not captured",
    confidence: sellerLead.contactConfidenceScore ?? 0,
    provider: "Tracerfy",
    lastUpdated: sellerLead.importedAt,
    sourceWorkspace: "/harvester",
    actions: ["Run Skip Trace", "View Contact Profile", "Send to Deal Engine", "Retry", "Mark Bad Contact"],
    mailingAddress: sellerLead.ownerMailingAddress,
    county: sellerLead.county,
    city: sellerLead.city,
    state: sellerLead.state ?? "NC",
    zip: sellerLead.zipCode,
    dossier: sellerLead.summary,
    eligibleForAutoTrace: true,
  };

  try {
    const result = await runNexusSkipTrace(nexusLead);
    return { ok: true as const, status: "completed", result };
  } catch (error) {
    return {
      ok: true as const,
      status: "placeholder",
      detail: error instanceof Error ? error.message : "Nexus enrichment placeholder triggered.",
    };
  }
}

export async function createDealFromHarvester(input: { intakeId: string }) {
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake) throw new Error("Harvester intake not found.");
  const sellerLeadId = intake.createdSellerLeadId ?? (await createSellerLeadFromHarvester({ intakeId: input.intakeId })).sellerLeadId;
  const result = await createDealFromSellerLead({ sellerLeadId });
  if (!result.ok) throw new Error(result.error);

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from("harvester_intakes")
      .update({
        created_deal_id: result.dealId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.intakeId);
  }

  return {
    ok: true as const,
    dealId: result.dealId,
    created: result.created,
    sellerLeadId,
  };
}

export async function runHarvesterBuyerMatch(input: { intakeId: string }) {
  const supabase = getSupabaseAdmin();
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake?.opportunity) throw new Error("Run extraction before buyer matching.");
  const opportunity = intake.opportunity;

  // Source of truth: the Buyer Engine's real BuyerProfile universe (+ institutional
  // groups). Harvester DISPLAYS the result; it no longer re-implements buyer logic.
  const buyerResult = await matchBuyersForProperty({
    county: opportunity.county,
    state: opportunity.state ?? "NC",
    city: opportunity.city,
    zip: opportunity.zip,
    propertyType: opportunity.beds && opportunity.baths ? "residential" : opportunity.condition ?? null,
    askingPrice: opportunity.askingPrice,
    beds: opportunity.beds,
    baths: opportunity.baths,
    limit: 10,
  });

  const ranked = buyerResult.matches.map((match) => ({
    buyerId: match.buyerId,
    buyerName: match.buyerName,
    buyerGroup: match.buyerType,
    matchScore: match.matchScore,
    reasons: match.reasons,
    recommendedAction: match.recommendedAction,
  }));

  if (supabase) {
    await supabase.from("harvester_buyer_matches").delete().eq("intake_id", input.intakeId);
    if (ranked.length) {
      await supabase.from("harvester_buyer_matches").insert(
        ranked.map((match) => ({
          intake_id: input.intakeId,
          opportunity_id: opportunity.id,
          buyer_id: match.buyerId,
          buyer_name: match.buyerName,
          buyer_group: match.buyerGroup,
          match_score: match.matchScore,
          reasons: match.reasons,
          recommended_action: match.recommendedAction,
        })),
      );
    }
  }

  let buyerEngineLaunch: { ok: boolean; detail?: string; error?: string } | null = null;
  if (intake.createdDealId) {
    const launched = await launchBuyerSearchFromDeal({ dealId: intake.createdDealId });
    buyerEngineLaunch = launched.ok
      ? { ok: true, detail: `Buyer Engine job launched from deal ${intake.createdDealId}.` }
      : { ok: false, error: launched.error };
  }

  return {
    ok: true as const,
    matches: ranked,
    buyerEngineLaunch,
    // Early buyer validation — demand signal before significant acquisition effort.
    validation: {
      buyerCount: buyerResult.buyerCount,
      demandScore: buyerResult.demandScore,
      assignmentPotential: buyerResult.assignmentPotential,
      county: buyerResult.county,
    },
  };
}

// Generate + persist a ready-to-send outreach message for a buyer match. We
// only have the buyer's mailing address (BuyerProfile has no email), so this
// produces the message for the operator to send through their channel and
// records it on the match.
export async function prepareHarvesterBuyerOutreach(input: { buyerMatchId: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Storage is not configured.");

  const { data: match } = await supabase
    .from("harvester_buyer_matches")
    .select("id, intake_id, opportunity_id, buyer_name, match_score")
    .eq("id", input.buyerMatchId)
    .maybeSingle();
  if (!match) throw new Error("Buyer match not found.");

  const { data: opp } = await supabase
    .from("harvester_extracted_opportunities")
    .select("address, city, state, county, asking_price, beds, baths, sqft, condition, occupancy_status, notes")
    .eq("id", match.opportunity_id)
    .maybeSingle();

  const buyerName = (match.buyer_name as string) || "there";
  const address = (opp?.address as string) || "an off-market property";
  const location = [opp?.city, opp?.county && `${opp.county} County`, opp?.state].filter(Boolean).join(", ");
  const price = opp?.asking_price ? `$${Number(opp.asking_price).toLocaleString()}` : "available on request";
  const beds = opp?.beds ?? null;
  const baths = opp?.baths ?? null;
  const sqft = opp?.sqft ?? null;
  const specs = [
    beds || baths ? `${beds ?? "?"} bed / ${baths ?? "?"} bath` : null,
    sqft ? `${Number(sqft).toLocaleString()} sqft` : null,
    opp?.occupancy_status ? String(opp.occupancy_status) : null,
    opp?.condition ? String(opp.condition) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const subject = `Off-market deal: ${address}${location ? ` (${location})` : ""}`;
  const body = [
    `Hi ${buyerName},`,
    "",
    `I have an off-market opportunity that fits your buy box:`,
    "",
    `Property: ${address}${location ? `, ${location}` : ""}`,
    `Asking: ${price}`,
    specs ? `Details: ${specs}` : "",
    "",
    `You're a strong fit based on your recent buying activity in this area. This is first-look before it goes wider.`,
    "",
    `If you're interested, reply with proof of funds and I'll send the full packet and access details.`,
    "",
    `Best,`,
    `Blackspire Helix`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  await supabase
    .from("harvester_buyer_matches")
    .update({
      outreach_status: "prepared",
      outreach_subject: subject,
      outreach_body: body,
      outreach_prepared_at: new Date().toISOString(),
    })
    .eq("id", input.buyerMatchId);

  return { ok: true as const, buyerMatchId: input.buyerMatchId, buyerName, subject, body };
}

export async function detectDuplicateHarvesterDeal(input: { intakeId: string; persist?: boolean }) {
  const supabase = getSupabaseAdmin();
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake?.opportunity) return { duplicates: [] as HarvesterDuplicateRecord[] };

  const normalized = normalizeAddress(intake.opportunity.address);
  const candidates = (await listHarvesterIntakes(200)).filter((row) => row.id !== input.intakeId);
  const sellerLeads = await listSellerLeads().catch(() => []);
  const duplicates: HarvesterDuplicateRecord[] = [];

  for (const candidate of candidates) {
    if (!candidate.opportunity) continue;
    let duplicateScore = 0;
    const reasons: string[] = [];

    if (normalized && normalized === normalizeAddress(candidate.opportunity.address)) {
      duplicateScore += 62;
      reasons.push("Normalized address matches an existing Harvester intake.");
    }
    if (intake.opportunity.phone && candidate.opportunity.phone && intake.opportunity.phone === candidate.opportunity.phone) {
      duplicateScore += 18;
      reasons.push("Poster phone matches a prior intake.");
    }
    if (intake.opportunity.email && candidate.opportunity.email && intake.opportunity.email === candidate.opportunity.email) {
      duplicateScore += 18;
      reasons.push("Poster email matches a prior intake.");
    }
    if (
      intake.opportunity.askingPrice &&
      candidate.opportunity.askingPrice &&
      Math.abs(intake.opportunity.askingPrice - candidate.opportunity.askingPrice) <= 5000
    ) {
      duplicateScore += 10;
      reasons.push("Asking price is within a narrow spread of a prior intake.");
    }
    if (duplicateScore >= 45) {
      duplicates.push({
        id: `${input.intakeId}-${candidate.id}`,
        intakeId: input.intakeId,
        matchedIntakeId: candidate.id,
        matchedSellerLeadId: candidate.createdSellerLeadId,
        matchedDealId: candidate.createdDealId,
        duplicateScore,
        reasons,
        resolutionStatus: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  for (const lead of sellerLeads) {
    let duplicateScore = 0;
    const reasons: string[] = [];
    if (normalized && normalized === normalizeAddress(lead.propertyAddress)) {
      duplicateScore += 72;
      reasons.push("Property already exists in Seller Engine.");
    }
    if (intake.opportunity.phone && lead.ownerPhone && intake.opportunity.phone === lead.ownerPhone) {
      duplicateScore += 16;
      reasons.push("Phone also appears on an existing seller lead.");
    }
    if (duplicateScore >= 45) {
      duplicates.push({
        id: `${input.intakeId}-${lead.id}`,
        intakeId: input.intakeId,
        matchedIntakeId: null,
        matchedSellerLeadId: lead.id,
        matchedDealId: lead.relatedDealId ?? null,
        duplicateScore,
        reasons,
        resolutionStatus: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (supabase && input.persist) {
    await supabase.from("harvester_duplicates").delete().eq("intake_id", input.intakeId);
    if (duplicates.length) {
      await supabase.from("harvester_duplicates").insert(
        duplicates.map((item) => ({
          intake_id: item.intakeId,
          matched_intake_id: item.matchedIntakeId,
          matched_seller_lead_id: item.matchedSellerLeadId,
          matched_deal_id: item.matchedDealId,
          duplicate_score: item.duplicateScore,
          reasons: item.reasons,
          resolution_status: item.resolutionStatus,
        })),
      );
    }
  }

  return { duplicates };
}

async function matchHarvesterWatchlists(opportunity: HarvesterOpportunityRecord, intakeId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data } = await supabase.from("harvester_watchlists").select("*").order("created_at", { ascending: false }).limit(25);
  const matches: Array<{ watchlistId: string; name: string; score: number; reasons: string[] }> = [];

  for (const row of (data ?? []) as WatchlistRow[]) {
    const criteria = row.criteria ?? {};
    let score = 0;
    const reasons: string[] = [];
    const counties = Array.isArray(criteria.targetCounties) ? criteria.targetCounties.map(String) : [];
    const cities = Array.isArray(criteria.targetCities) ? criteria.targetCities.map(String) : [];
    const maxPrice = toNumber(criteria.maxPrice);
    const minBeds = toNumber(criteria.minBeds);

    if (counties.some((value) => value.toLowerCase() === (opportunity.county ?? "").toLowerCase())) {
      score += 40;
      reasons.push("County matches watchlist.");
    }
    if (cities.some((value) => value.toLowerCase() === (opportunity.city ?? "").toLowerCase())) {
      score += 25;
      reasons.push("City matches watchlist.");
    }
    if (maxPrice && opportunity.askingPrice && opportunity.askingPrice <= maxPrice) {
      score += 18;
      reasons.push("Price is within target range.");
    }
    if (minBeds && opportunity.beds && opportunity.beds >= minBeds) {
      score += 12;
      reasons.push("Bedroom count meets minimum.");
    }

    if (score >= 40) {
      matches.push({ watchlistId: row.id, name: row.name, score, reasons });
    }
  }

  await supabase.from("harvester_watchlist_matches").delete().eq("intake_id", intakeId);
  if (matches.length) {
    await supabase.from("harvester_watchlist_matches").insert(
      matches.map((match) => ({
        watchlist_id: match.watchlistId,
        intake_id: intakeId,
        opportunity_id: opportunity.id,
        match_score: match.score,
        reasons: match.reasons,
        seen_at: new Date().toISOString(),
      })),
    );
  }

  return matches;
}

export async function createOrUpdateMarketplaceEntity(input: { intakeId: string }) {
  const supabase = getSupabaseAdmin();
  const intake = await getHarvesterIntakeDetail(input.intakeId);
  if (!intake?.opportunity) throw new Error("No extracted opportunity exists for this intake.");
  if (!supabase) {
    return {
      ok: true as const,
      entity: null,
      storageMode: "demo",
    };
  }

  const entityName =
    intake.opportunity.sellerName
    || (typeof intake.metadata.posterName === "string" ? intake.metadata.posterName : null)
    || intake.sourceName
    || "Unknown poster";

  const { data: existing } = await supabase
    .from("marketplace_entities")
    .select("*")
    .or(`email.eq.${intake.opportunity.email ?? ""},phone.eq.${intake.opportunity.phone ?? ""},entity_name.eq.${entityName}`)
    .limit(1)
    .maybeSingle();

  const nextPostCount = (existing?.post_count ?? 0) + 1;
  const nextDealCount = (existing?.deal_count ?? 0) + (intake.createdDealId ? 1 : 0);
  const nextAverage =
    intake.opportunity.askingPrice != null
      ? (((toNumber(existing?.average_asking_price) ?? 0) * (existing?.post_count ?? 0)) + intake.opportunity.askingPrice) / nextPostCount
      : toNumber(existing?.average_asking_price);
  const markets = Array.from(
    new Set([...(existing?.markets ?? []), [intake.opportunity.city, intake.opportunity.state].filter(Boolean).join(", ")]),
  ).filter(Boolean);
  const sourceProfiles = [
    ...((existing?.source_profiles as Array<Record<string, unknown>> | undefined) ?? []),
    {
      sourceType: intake.sourceType,
      sourceName: intake.sourceName,
      sourceUrl: intake.sourceUrl,
      intakeId: intake.id,
      classification: intake.classification,
    },
  ];

  const { data, error } = await supabase
    .from("marketplace_entities")
    .upsert({
      id: existing?.id,
      entity_name: entityName,
      entity_type: classifyEntity(intake),
      phone: intake.opportunity.phone,
      email: intake.opportunity.email,
      source_profiles: sourceProfiles,
      markets,
      average_asking_price: nextAverage,
      post_count: nextPostCount,
      deal_count: nextDealCount,
      buyer_signal_count: existing?.buyer_signal_count ?? 0,
      reputation_score: Math.min(100, 40 + nextPostCount * 4 + (nextDealCount > 0 ? 6 : 0)),
      classification: intake.classification,
      classification_confidence: intake.extractionConfidence,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return {
    ok: true as const,
    entity: mapEntity(data as MarketplaceEntityRow),
    storageMode: "supabase",
  };
}

function classifyEntity(intake: HarvesterIntakeRecord) {
  const classification = intake.classification ?? "";
  if (classification === "buyer_demand") return "buyer";
  if (classification === "wholesaler_inventory") return "wholesaler";
  if (classification === "seller_opportunity") return "seller";
  return "unknown";
}

export async function getHarvesterWorkspaceSnapshot(): Promise<HarvesterWorkspaceSnapshot> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return getDemoSnapshot();

  await ensureDefaultWatchlist(supabase);

  const [intakes, entitiesRes, watchlistsRes] = await Promise.all([
    listHarvesterIntakes(75),
    supabase.from("marketplace_entities").select("*").order("updated_at", { ascending: false }).limit(25),
    supabase.from("harvester_watchlists").select("*").order("updated_at", { ascending: false }).limit(25),
  ]);

  const extractedDeals = intakes.flatMap((intake) => (intake.opportunity ? [intake.opportunity] : []));
  const buyerMatches = intakes.flatMap((intake) => intake.buyerMatches ?? []);
  const duplicateAlerts = intakes.reduce((count, intake) => count + (intake.duplicates?.length ?? 0), 0);
  const watchlists = ((watchlistsRes.data ?? []) as WatchlistRow[]).map(mapWatchlist);
  const watchlistHits = duplicateAlerts >= 0
    ? await supabase.from("harvester_watchlist_matches").select("id", { count: "exact", head: true })
    : null;

  return {
    metrics: [
      { label: "Total Intakes", value: String(intakes.length).padStart(2, "0"), detail: "New screenshots, posts, PDFs, and pasted text captured by Harvester." },
      { label: "Opportunities Extracted", value: String(extractedDeals.length).padStart(2, "0"), detail: "Structured opportunity records available for review." },
      { label: "Seller Leads Created", value: String(intakes.filter((item) => item.createdSellerLeadId).length).padStart(2, "0"), detail: "Harvester opportunities already handed into Seller Engine." },
      { label: "Deals Created", value: String(intakes.filter((item) => item.createdDealId).length).padStart(2, "0"), detail: "Deal Engine records created from Harvester approvals." },
      { label: "Buyer Matches Found", value: String(buyerMatches.length).padStart(2, "0"), detail: "Buyer group matches ranked from Harvester opportunities." },
      { label: "Duplicate Alerts", value: String(duplicateAlerts).padStart(2, "0"), detail: "Potential recycled inventory or repeat intake warnings." },
      { label: "Watchlist Hits", value: String(watchlistHits?.count ?? 0).padStart(2, "0"), detail: "Watchlist matches triggered by new marketplace intake." },
    ],
    intakes,
    extractedDeals,
    entities: ((entitiesRes.data ?? []) as MarketplaceEntityRow[]).map(mapEntity),
    buyerMatches,
    watchlists,
    alerts: [
      {
        id: "harvester-disclaimer",
        title: "Permission-only intake",
        detail: "Only upload or paste content you have permission to use. Harvester does not log into private platforms or bypass group rules.",
        severity: "info",
      },
      {
        id: "harvester-ocr",
        title: process.env.OPENAI_API_KEY?.trim() ? "AI vision OCR is live" : "OCR key not configured",
        detail: process.env.OPENAI_API_KEY?.trim()
          ? "Screenshot and flyer images are read automatically with AI vision OCR, then run through structured extraction. PDFs store metadata only for now."
          : "Image OCR needs OPENAI_API_KEY. Add the key in the deployment environment to enable automatic screenshot and flyer reading. Text intake works without it.",
        severity: process.env.OPENAI_API_KEY?.trim() ? "success" : "warning",
      },
    ],
    tabs: [
      { id: "intake", label: "Intake", count: intakes.length },
      { id: "deals", label: "Extracted Deals", count: extractedDeals.length },
      { id: "intelligence", label: "Marketplace Intelligence", count: ((entitiesRes.data ?? []) as MarketplaceEntityRow[]).length },
      { id: "profiles", label: "Poster Profiles", count: ((entitiesRes.data ?? []) as MarketplaceEntityRow[]).length },
      { id: "buyers", label: "Buyer Signals", count: buyerMatches.length },
      { id: "watchlists", label: "Watchlists", count: watchlists.length },
      { id: "settings", label: "Settings", count: 2 },
    ],
    branding: getHarvesterBranding(),
  };
}
