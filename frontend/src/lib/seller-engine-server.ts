import "server-only";

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { DEMO_SELLER_LEADS, type SellerLeadView } from "@/lib/seller-engine-demo";
import { SELLER_COUNTY_STARTER_SOURCES } from "@/lib/seller-county-sources";
import {
  calculateSellerLeadScore,
  DEFAULT_SELLER_SCORING_WEIGHTS,
  parseSellerCsv,
  recommendedSellerAction,
  type SellerLeadStatus,
  type SellerLiveSourceKey,
  type SellerScoringWeights,
  type SellerSourceType,
  SELLER_LIVE_SOURCES,
  SELLER_LIVE_SOURCE_KEY,
} from "@/lib/seller-engine";

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bool(value: string | undefined) {
  return ["1", "true", "yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function numberOrNull(value: string | undefined) {
  const parsed = Number((value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && value?.trim() ? parsed : null;
}

function splitAddress(value: string) {
  const parts = value.split(",").map((part) => part.trim());
  const stateZip = parts.at(-1)?.match(/\b([A-Z]{2})\s+(\d{5})\b/i);
  return {
    city: parts.length >= 3 ? parts.at(-2) ?? null : null,
    state: stateZip?.[1]?.toUpperCase() ?? null,
    zip: stateZip?.[2] ?? null,
  };
}

function normalizeWeights(value: unknown): SellerScoringWeights {
  const weights = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const read = (camelKey: keyof SellerScoringWeights, snakeKey: string) => {
    const parsed = Number(weights[camelKey] ?? weights[snakeKey]);
    return Number.isFinite(parsed) ? parsed : DEFAULT_SELLER_SCORING_WEIGHTS[camelKey];
  };

  return {
    absenteeOwner: read("absenteeOwner", "absentee_owner"),
    ownedTenPlusYears: read("ownedTenPlusYears", "owned_10_years"),
    taxDelinquent: read("taxDelinquent", "tax_delinquent"),
    foreclosure: read("foreclosure", "foreclosure"),
    probate: read("probate", "probate"),
    vacant: read("vacant", "vacant"),
    codeViolation: read("codeViolation", "code_violation"),
    highEquity: read("highEquity", "high_equity"),
    multipleProperties: read("multipleProperties", "multiple_properties"),
    outOfStateOwner: read("outOfStateOwner", "out_of_state_owner"),
  };
}

async function getWeights(supabase: SupabaseClient): Promise<SellerScoringWeights> {
  const { data } = await supabase
    .from("seller_scoring_settings")
    .select("weights")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalizeWeights(data?.weights);
}

type SellerLeadJoin = {
  id: string;
  status: SellerLeadStatus;
  motivation_score: number;
  lead_category: string;
  motivation_reasons: string[];
  recommended_action: string | null;
  ai_summary: string | null;
  created_at: string;
  owners: { name: string; mailing_address: string | null; mailing_state: string | null } | null;
  properties: {
    property_address: string;
    parcel_id: string | null;
    county: string | null;
    city: string | null;
    zip_code: string | null;
    property_type: string | null;
    assessed_value: number | null;
    estimated_equity: number | null;
    years_owned: number | null;
    tax_delinquent: boolean;
    foreclosure: boolean;
    probate: boolean;
    vacant: boolean;
    code_violation: boolean;
    owner_occupancy_status: string | null;
    data_sources: { name: string; source_type: string | null; integration_type: string | null; source_url: string | null } | null;
  } | null;
};

type SellerLeadNoteRow = {
  id: string;
  note: string;
  created_at: string;
};

type SellerLeadStatusHistoryRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
};

function mapSellerLead(lead: SellerLeadJoin): SellerLeadView {
  return {
    id: lead.id,
    ownerName: lead.owners?.name ?? "Unknown owner",
    ownerMailingAddress: lead.owners?.mailing_address ?? "Not available",
    propertyAddress: lead.properties?.property_address ?? "Unknown property",
    parcelId: lead.properties?.parcel_id ?? "Not available",
    county: lead.properties?.county ?? "Unknown",
    city: lead.properties?.city ?? "Unknown",
    zipCode: lead.properties?.zip_code ?? "",
    propertyType: lead.properties?.property_type ?? "Unknown",
    assessedValue: lead.properties?.assessed_value ?? 0,
    estimatedEquity: lead.properties?.estimated_equity ?? 0,
    yearsOwned: lead.properties?.years_owned ?? 0,
    ownerOccupancyStatus: lead.properties?.owner_occupancy_status ?? "Unknown",
    status: lead.status,
    score: lead.motivation_score,
    category: lead.lead_category,
    reasons: lead.motivation_reasons ?? [],
    sourceName: lead.properties?.data_sources?.name ?? "Unknown source",
    sourceType: lead.properties?.data_sources?.source_type ?? undefined,
    sourceIntegrationType: lead.properties?.data_sources?.integration_type ?? undefined,
    importedAt: lead.created_at,
    recommendedAction: lead.recommended_action ?? recommendedSellerAction(lead.motivation_score, lead.motivation_reasons ?? []),
    summary: lead.ai_summary ?? "AI seller intelligence summary has not been generated yet.",
    notes: [],
    statusHistory: [],
    relatedDealId: null,
    signals: {
      absenteeOwner: /absentee/i.test(lead.properties?.owner_occupancy_status ?? ""),
      taxDelinquent: Boolean(lead.properties?.tax_delinquent),
      foreclosure: Boolean(lead.properties?.foreclosure),
      probate: Boolean(lead.properties?.probate),
      vacant: Boolean(lead.properties?.vacant),
      codeViolation: Boolean(lead.properties?.code_violation),
    },
  };
}

type SellerImportRow = Record<string, string>;

type LiveSellerSearchInput = {
  sourceKey?: SellerLiveSourceKey;
  county: string;
  city?: string;
  limit?: number;
};

type NcOneMapAttributes = {
  parno?: string;
  ownname?: string;
  ownlast?: string;
  mailadd?: string;
  mcity?: string;
  mstate?: string;
  mzip?: string;
  saddno?: string;
  saddpref?: string;
  saddstname?: string;
  saddstr?: string;
  saddstsuf?: string;
  saddsttyp?: string;
  scity?: string;
  szip?: string;
  parval?: number;
  saledate?: number;
  cntyname?: string;
  parusedesc?: string;
  parusedsc2?: string;
  gisacres?: number;
};

type GuilfordForeclosureAttributes = {
  Owner?: string;
  LOCATION_ADDR?: string;
  Total_Assessed?: number;
  PARCEL_ID?: string;
  FLAG_STATUS?: string;
  AuctionDate?: number;
  AuctionTime?: string;
  AuctionLocation?: string;
  Mail_Address?: string;
  Mail_City?: string;
  Mail_State?: string;
  Mail_Zip?: string;
  Property_Type?: string;
  DEED_DATE?: number;
  PIN?: string;
  REID?: string;
  PROPERTY_DESCR?: string;
};

type WakeParcelAttributes = {
  PIN_NUM?: string;
  REID?: string;
  OWNER?: string;
  ADDR1?: string;
  ADDR2?: string;
  ADDR3?: string;
  DEED_BOOK?: string;
  DEED_PAGE?: string;
  DEED_DATE?: number;
  TOTAL_VALUE_ASSD?: number;
  SITE_ADDRESS?: string;
  CITY_DECODE?: string;
  YEAR_BUILT?: number;
  TOTSALPRICE?: number;
  SALE_DATE?: number;
  TYPE_USE_DECODE?: string;
  LAND_CLASS?: string;
  LAND_CLASS_DECODE?: string;
};

type BeaufortParcelAttributes = {
  REID?: string;
  GPIN?: string;
  GPINLONG?: string;
  NAME1?: string;
  NAME2?: string;
  ADDR1?: string;
  ADDR2?: string;
  CITY?: string;
  STATE?: string;
  ZIP?: string;
  PROP_DESC?: string;
  LAND_VAL?: number;
  BLDG_VAL?: number;
  TOT_VAL?: number;
  ACRES?: number;
  PROP_ADDR?: string;
  DATE?: string;
  SALE_PRICE?: number;
  NBR_BLDG?: number;
  LAND_USE?: string;
  YR_BUILT?: number;
  DB_PG?: string;
  DEED_BOOK?: string;
  DEED_PAGE?: string;
  date_dt?: number;
};

type GranvilleParcelAttributes = {
  PIN?: string;
  MAPN?: string;
  PRODNO?: string;
  RECN?: string;
  Parcel?: string;
  OwnerName1?: string;
  OwnerName2?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  City?: string;
  State?: string;
  Zip?: string;
  FormattedPropertyAddress?: string;
  LegalDescription?: string;
  DeedDate?: number;
  DeedBookPage?: string;
  BuildingValue?: number;
  LandValue?: number;
  AssessedValue?: number;
  MarketValue?: number;
  SalePrice?: number;
  PRC?: string;
};

type SampsonParcelAttributes = {
  PIN?: string;
  CURRENT_OW?: string;
  CURRENT_AD?: string;
  CURRENT_CI?: string;
  CURRENT_ST?: string;
  CURRENT_ZI?: string;
  BK_PG?: string;
  SALE_PRICE?: number;
  DATE_RECOR?: string;
  PARCEL_ADD?: string;
  SEG_TYPE_D?: string;
  USE_DESC?: string;
  ASSESSED_V?: number;
  PARCEL_CLA?: string;
  DEED?: string;
  YEAR_BUILT?: number;
};

type StokesParcelAttributes = {
  PARCEL_NUMBER?: string;
  PIN?: string;
  PARCEL_DESCRIPTION?: string;
  PHYSICAL_ADDRESS?: string;
  LAND_CLASS?: string;
  PROPERTY_OWNER_1?: string;
  PROPERTY_OWNER_2?: string;
  OWNER_MAIL_ADDR_1?: string;
  OWNER_MAIL_ADDR_2?: string;
  OWNER_MAIL_ADDR_3?: string;
  OWNER_MAIL_ADDR_CITY?: string;
  OWNER_MAIL_ADDR_STATE?: string;
  OWNER_MAIL_ADDR_ZIP?: string;
  PHYS_ADDR_CITY?: string;
  PHYS_ADDR_STATE?: string;
  PHYS_ADDR_ZIP?: string;
  DEED_DATE?: number;
  DEED_BOOK?: string;
  DEED_PAGE?: string;
  DEED_BKPG?: string;
};

type StanlyParcelAttributes = {
  PIN?: string;
  Name1?: string;
  Name2?: string;
  Name3?: string;
  TaxPayerAddr1?: string;
  TaxPayerAddr2?: string;
  TaxPayerCity?: string;
  State?: string;
  Zip?: string;
  PhyStreetAddr?: string;
  DateSold?: number;
  SaleAmount?: number;
  DeedBook?: number;
  DeedPage?: number;
  YearBuilt?: number;
  TotalASVCurrent?: number;
  Description1?: string;
};

type WilkesParcelAttributes = {
  PARCEL_ID?: string;
  OWNER1?: string;
  MAILADD1?: string;
  MAILADD2?: string;
  CITY?: string;
  STATE?: string;
  ZIP?: string;
  PIN?: string;
  PROPLOCAT?: string;
  COSTLANDVA?: number;
  COSTBLDGVA?: number;
  COSTTOTVA?: number;
  LANDTYPE?: string;
  YEARBUILT?: number;
  EFFYEARBLT?: number;
  SALEPRICE?: number;
  SALE_VALIDITY?: string;
  SALETYPE?: string;
  SALEDATE?: number;
  BOOK_PAGE?: string;
};

type WarrenParcelAttributes = {
  NEWPIN?: string;
  MAPN?: string;
  NAME1?: string;
  NAME2?: string;
  ADDR?: string;
  CITY?: string;
  STATE?: string;
  ZIP?: string;
  SITUS_ADDRESS?: string;
  SALE_PRICE?: number;
  DEEDDATE?: number;
  DEEDBOOK?: string;
  DEEDPAGE?: string;
};

type RobesonParcelAttributes = {
  PIN_NUMBER?: string;
  OWNAM1?: string;
  OWNAM2?: string;
  OWCITY?: string;
  OWSTATE?: string;
  OWZIP?: string;
  PHYSTRADR?: string;
  DATESOLD?: number | string;
  SALEAMT?: number;
  DEEDBOOK?: string;
  DEEDPAGE?: string;
};

type RockinghamParcelAttributes = {
  ownname?: string;
  ownname2?: string;
  mailadd?: string;
  munit?: string;
  mcity?: string;
  mstate?: string;
  mzip?: string;
  siteadd?: string;
  scity?: string;
  parno?: string;
  altparno?: string;
  saledate?: number;
  saledatetx?: string;
  sourceref?: string;
  struct?: string;
  structno?: number;
  parusedesc?: string;
  cntyname?: string;
  parval?: number;
  landval?: number;
};

type OrangeParcelAttributes = {
  PIN?: string;
  OWNER1?: string;
  OWNER2?: string;
  ADDRESS1?: string;
  ADDRESS2?: string;
  CITY?: string;
  STATE?: string;
  ZIPCODE?: string;
  LANDVALUE?: number;
  BLDGVALUE?: number;
  BLDGCNT?: number;
  VALUATION?: number;
  DEEDREF?: string;
  DATESOLD?: number;
  DATESOLDTXT?: string;
  YEARBUILT?: number;
  SQFT?: number;
  LEGAL_DESC?: string;
};

type NashParcelAttributes = {
  GIS_PARID?: string;
  GIS_PIN?: string;
  TAX_PARID?: string;
  TAX_PIN?: string;
  OWNER1?: string;
  OWNER2?: string;
  CAREOF?: string;
  MAIL_ADDR1?: string;
  MAIL_ADDR2?: string;
  ML_C_ST_Z?: string;
  PHYS_ADDR?: string;
  DESCRIPLOC?: string;
  LANDTYPE?: string;
  DEEDACRES?: number;
  GIS_ACRES?: number;
  DEEDBOOK?: string;
  DEEDPAGE?: string;
  SALEDATE?: number;
  SALECODE?: string;
  SALEPRICE?: number;
  PROPTYPE?: string;
  LANDVALUE?: number;
  TOT_B_VAL?: number;
  APR_VAL?: number;
  ASM_VAL?: number;
  LEGAL1?: string;
  LEGAL2?: string;
  LEGAL3?: string;
};

type EdgecombeParcelAttributes = {
  parcel?: string;
  owner?: string;
  address?: string;
  city?: string;
  st?: string;
  zip?: string;
  location?: string;
  propdescr?: string;
  deeddate?: number;
  salepr?: number;
  bk_pg?: string;
  account?: string;
  twp?: string;
  acreage?: number;
  landval?: number;
  bldgval?: number;
  netval?: number;
  deferred?: number;
  subdivisio?: string;
  pclass?: string;
  pin?: string;
  pinsuf?: string;
  altpin?: string;
  linkpin?: string;
  deeddatestr?: string;
};

type AsheParcelAttributes = {
  ParcelNumb?: string;
  GPIN?: string;
  Name1?: string;
  Address1?: string;
  Address2?: string;
  Address3?: string;
  City?: string;
  State?: string;
  ZipCode?: string;
  LegalLandU?: string;
  LegalLandT?: string;
  DeedDate?: number;
  DeedBook?: string;
  DeedPage?: string;
  SalePrice?: number;
  SaleYear?: number;
  ParcelProp?: string;
  LegalDescr?: string;
  ParcelLand?: number;
  ParcelBuil?: number;
  ParcelObxf?: number;
  TotalMarke?: number;
  TotalAsses?: number;
  OwnershipT?: string;
};

type AveryParcelAttributes = {
  PIN?: string;
  OWNER_NAME?: string;
  NAME_1?: string;
  ADDR_1?: string;
  ADDR_2?: string;
  ADDR_3?: string;
  CITY?: string;
  STATE?: string;
  ZIP?: string;
  ADDRESS?: string;
  DEED_DATE?: number;
  DEEDBOOK?: string;
  DEEDPAGE?: string;
  SALEPRICE?: number;
  LAND_VALU?: number;
  BUILD_VALU?: number;
  TOTAL_VALU?: number;
  AYB?: number;
  ACREAGE?: number;
  LEGAL_1?: string;
  LEGAL_2?: string;
  PARNUM?: string;
  ACCT_NO?: string;
  TAX_YEAR?: string;
};

type BurkeParcelAttributes = {
  PARCEL_PK?: string;
  PIN?: string;
  PIN_EXT?: string;
  LOCATION_ADDR?: string;
  LAND_CLASS?: string;
  DEEDED_ACRES?: number;
  PROPERTY_OWNER?: string;
  OWNER_MAIL_1?: string;
  OWNER_MAIL_2?: string;
  OWNER_MAIL_3?: string;
  OWNER_MAIL_CITY?: string;
  OWNER_MAIL_STATE?: string;
  OWNER_MAIL_ZIP?: string;
  TOTAL_LAND_VALUE_ASSESSED?: number;
  TOTAL_BLDG_VALUE_ASSESSED?: number;
  LAND_USE_VALUE?: number;
  DEED_DATE?: number;
  DEED_BOOK?: string;
  DEED_PAGE?: string;
  PKG_SALE_DATE?: number;
  PKG_SALE_PRICE?: number;
  LAND_SALE_DATE?: number;
  LAND_SALE_PRICE?: number;
};

type XlsxSharedStrings = string[];

type GenericNcParcelAttributes = {
  // Parcel ID (various NC county naming conventions)
  PIN?: string; PIN_NUM?: string; PARCEL_ID?: string; PARCEL_NUMBER?: string; PARCEL_PK?: string;
  GIS_PARID?: string; TAX_PARID?: string; REID?: string; parno?: string; GPIN?: string; GPINLONG?: string;
  // Owner name
  OWNER?: string; OWNER1?: string; OWNER2?: string; PROPERTY_OWNER?: string; OWNNAME?: string;
  NAME1?: string; NAME2?: string; ownname?: string; ownlast?: string;
  // Mailing address lines
  ADDR1?: string; ADDR2?: string; MAILADD?: string; MAIL_ADDR1?: string; MAIL_ADDR2?: string;
  OWNER_MAIL_1?: string; OWNER_MAIL_2?: string; OWNER_MAIL_3?: string;
  ADDRESS1?: string; ADDRESS2?: string; TaxPayerAddr1?: string; TaxPayerAddr2?: string; mailadd?: string;
  // Mailing city
  CITY?: string; MAIL_CITY?: string; OWNER_MAIL_CITY?: string; TaxPayerCity?: string; mcity?: string;
  // Mailing state
  STATE?: string; MAIL_STATE?: string; OWNER_MAIL_STATE?: string; mstate?: string;
  // Mailing zip
  ZIP?: string; ZIPCODE?: string; MAIL_ZIP?: string; OWNER_MAIL_ZIP?: string; mzip?: string; Zip?: string;
  // Property address
  SITE_ADDRESS?: string; PROP_ADDR?: string; LOCATION_ADDR?: string; PHYSICAL_ADDRESS?: string;
  PHYS_ADDR?: string; PARCEL_ADD?: string; PhyStreetAddr?: string; FormattedPropertyAddress?: string;
  siteadd?: string; saddno?: string; saddstr?: string; saddstname?: string; saddstsuf?: string; saddsttyp?: string;
  // Property city
  CITY_DECODE?: string; PHYS_ADDR_CITY?: string; scity?: string;
  // Assessed / market value
  TOTAL_VALUE_ASSD?: number; TOT_VAL?: number; ASM_VAL?: number; APR_VAL?: number; ASSESSED_V?: number;
  VALUATION?: number; parval?: number; TotalASVCurrent?: number; TotalAsses?: number; AssessedValue?: number;
  LAND_VAL?: number; BLDG_VAL?: number; LAND_VALUE?: number; BLDGVALUE?: number; LANDVALUE?: number;
  TOTAL_LAND_VALUE_ASSESSED?: number; TOTAL_BLDG_VALUE_ASSESSED?: number;
  // Sale date
  DEED_DATE?: number; DEEDDATE?: number; SALEDATE?: number; SALE_DATE?: number; saledate?: number;
  PKG_SALE_DATE?: number; DATESOLD?: number | string; DateSold?: number; DeedDate?: number; date_dt?: number;
  // Sale price
  SALEPRICE?: number; SALE_PRICE?: number; SalePrice?: number; TOTSALPRICE?: number; PKG_SALE_PRICE?: number;
  // Property type
  LAND_USE?: string; LANDTYPE?: string; LAND_CLASS?: string; TYPE_USE_DECODE?: string; LAND_CLASS_DECODE?: string;
  parusedesc?: string; parusedsc2?: string; PROPTYPE?: string; PARCEL_CLA?: string; LegalLandT?: string;
  // Building presence
  NBR_BLDG?: number; BLDGCNT?: number; TOT_B_VAL?: number;
};

type BuyerCountyRegistryRow = {
  id: string;
  county: string;
  state: string;
  source_type: string;
  source_url: string | null;
  active: boolean;
  notes: string | null;
  created_at: string | null;
};

const NC_ONEMAP_LEGACY_ABSENTEE_MAX_SALEDATE = "2016-01-01";
const NC_ONEMAP_HIGH_VALUE_MIN_ASSESSED = 300000;
const NC_ONEMAP_CORPORATE_OWNER_PATTERN = /\b(LLC|LP|LLP|INC|CORP|CO\b|COMPANY|HOLDINGS?|PROPERTIES|INVESTMENTS?|TRUST|TR)\b/i;

export async function listSellerLeads(): Promise<SellerLeadView[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return DEMO_SELLER_LEADS;

  const { data, error } = await supabase
    .from("seller_leads")
    .select("id,status,motivation_score,lead_category,motivation_reasons,recommended_action,ai_summary,created_at,owners(name,mailing_address,mailing_state),properties(property_address,parcel_id,county,city,zip_code,property_type,assessed_value,estimated_equity,years_owned,tax_delinquent,foreclosure,probate,vacant,code_violation,owner_occupancy_status,data_sources(name,source_type,integration_type,source_url))")
    .order("motivation_score", { ascending: false })
    .limit(500);

  if (error) return DEMO_SELLER_LEADS;
  if (!data?.length) return [];

  return (data as unknown as SellerLeadJoin[]).map(mapSellerLead);
}

export async function getSellerLeadDetail(id: string): Promise<SellerLeadView | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return DEMO_SELLER_LEADS.find((lead) => lead.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("seller_leads")
    .select("id,status,motivation_score,lead_category,motivation_reasons,recommended_action,ai_summary,created_at,owners(name,mailing_address,mailing_state),properties(property_address,parcel_id,county,city,zip_code,property_type,assessed_value,estimated_equity,years_owned,tax_delinquent,foreclosure,probate,vacant,code_violation,owner_occupancy_status,data_sources(name,source_type,integration_type,source_url))")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const lead = mapSellerLead(data as unknown as SellerLeadJoin);
  const [notesResult, historyResult, dealResult] = await Promise.all([
    supabase
      .from("lead_notes")
      .select("id,note,created_at")
      .eq("seller_lead_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("lead_status_history")
      .select("id,from_status,to_status,created_at")
      .eq("seller_lead_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("deal_leads")
      .select("id")
      .eq("property_address", lead.propertyAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  lead.notes = (notesResult.data ?? []).map((note) => ({
    id: String((note as SellerLeadNoteRow).id),
    note: (note as SellerLeadNoteRow).note,
    createdAt: (note as SellerLeadNoteRow).created_at,
  }));
  lead.statusHistory = (historyResult.data ?? []).map((event) => ({
    id: String((event as SellerLeadStatusHistoryRow).id),
    fromStatus: (event as SellerLeadStatusHistoryRow).from_status,
    toStatus: (event as SellerLeadStatusHistoryRow).to_status,
    createdAt: (event as SellerLeadStatusHistoryRow).created_at,
  }));
  lead.relatedDealId = dealResult.data?.id ? String(dealResult.data.id) : null;

  return lead;
}

async function ensureSellerSource(
  supabase: SupabaseClient,
  input: {
    sourceName: string;
    sourceType: string;
    county?: string;
    integrationType?: string;
    sourceUrl?: string;
    configuration?: Record<string, unknown>;
  },
) {
  const integrationType = input.integrationType || "manual_csv";
  const { data: existing } = await supabase
    .from("data_sources")
    .select("id")
    .eq("name", input.sourceName)
    .eq("source_type", input.sourceType)
    .eq("integration_type", integrationType)
    .eq("county", input.county || null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("data_sources")
      .update({
        source_url: input.sourceUrl || null,
        configuration: input.configuration ?? {},
        last_imported_at: new Date().toISOString(),
        active: true,
      })
      .eq("id", existing.id);
    return { id: existing.id as string };
  }

  const { data: source, error: sourceError } = await supabase
    .from("data_sources")
    .insert({
      name: input.sourceName,
      source_type: input.sourceType,
      county: input.county || null,
      integration_type: integrationType,
      source_url: input.sourceUrl || null,
      configuration: input.configuration ?? {},
      last_imported_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (sourceError) throw new Error(sourceError.message);
  return { id: source.id as string };
}

async function importSellerRows(input: {
  rows: SellerImportRow[];
  sourceName: string;
  sourceType: string;
  county?: string;
  integrationType?: string;
  sourceUrl?: string;
  configuration?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server credentials are required for seller imports.");
  if (!input.rows.length) throw new Error("The import did not contain any data rows.");
  const weights = await getWeights(supabase);
  const source = await ensureSellerSource(supabase, input);

  let imported = 0;
  const errors: string[] = [];
  for (const row of input.rows) {
    try {
      const ownerMail = row.owner_mailing_address ?? "";
      const mailing = splitAddress(ownerMail);
      const { data: owner, error: ownerError } = await supabase
        .from("owners")
        .insert({ name: row.owner_name || "Unknown owner", mailing_address: ownerMail || null, mailing_city: mailing.city, mailing_state: mailing.state, mailing_zip: mailing.zip })
        .select("id")
        .single();
      if (ownerError) throw ownerError;

      const propertyState = (row.state || "NC").toUpperCase();
      const score = calculateSellerLeadScore({
        absenteeOwner: /absentee|non.?owner/i.test(row.owner_occupancy_status ?? ""),
        yearsOwned: numberOrNull(row.years_owned),
        taxDelinquent: bool(row.tax_delinquent),
        foreclosure: bool(row.foreclosure),
        probate: bool(row.probate),
        vacant: bool(row.vacant),
        codeViolation: bool(row.code_violation),
        assessedValue: numberOrNull(row.assessed_value),
        estimatedEquity: numberOrNull(row.estimated_equity),
        multipleProperties: bool(row.multiple_properties),
        outOfStateOwner: Boolean(mailing.state && mailing.state !== propertyState),
      }, weights);

      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .upsert({
          owner_id: owner.id,
          data_source_id: source.id,
          property_address: row.property_address || "Unknown property",
          parcel_id: row.parcel_id || null,
          county: row.county || input.county || null,
          city: row.city || null,
          state: propertyState,
          zip_code: row.zip_code || null,
          property_type: row.property_type || null,
          assessed_value: numberOrNull(row.assessed_value),
          last_sale_date: row.last_sale_date || null,
          last_sale_price: numberOrNull(row.last_sale_price),
          owner_occupancy_status: row.owner_occupancy_status || null,
          tax_delinquent: bool(row.tax_delinquent),
          foreclosure: bool(row.foreclosure),
          probate: bool(row.probate),
          vacant: bool(row.vacant),
          code_violation: bool(row.code_violation),
          years_owned: numberOrNull(row.years_owned),
          estimated_equity: numberOrNull(row.estimated_equity),
          raw_source_data: row,
        }, { onConflict: "county,parcel_id" })
        .select("id")
        .single();
      if (propertyError) throw propertyError;

      const recommendedAction = recommendedSellerAction(score.score, score.reasons);
      const { data: lead, error: leadError } = await supabase
        .from("seller_leads")
        .upsert({
          property_id: property.id,
          owner_id: owner.id,
          motivation_score: score.score,
          lead_category: score.category,
          motivation_reasons: score.reasons,
          recommended_action: recommendedAction,
        }, { onConflict: "property_id" })
        .select("id")
        .single();
      if (leadError) throw leadError;

      await supabase.from("lead_scores").insert({ seller_lead_id: lead.id, score: score.score, category: score.category, reasons: score.reasons, weights_snapshot: weights });
      if (score.score >= 80 || bool(row.foreclosure) || bool(row.probate)) {
        await supabase.from("seller_alerts").insert({
          seller_lead_id: lead.id,
          alert_type: score.score >= 80 ? "new_hot_lead" : bool(row.foreclosure) ? "new_foreclosure_lead" : "new_probate_lead",
          title: score.score >= 80 ? "New hot seller lead" : "New distress signal",
          message: `${row.owner_name || "Owner"} at ${row.property_address || "property"} scored ${score.score}.`,
          email_template: { subject: `Seller Engine alert: ${score.category}`, body: recommendedAction },
        });
      }
      imported += 1;
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "Row import failed",
      );
    }
  }

  return { imported, total: input.rows.length, errors };
}

export async function importSellerCsv(input: {
  csv: string;
  sourceName: string;
  sourceType: string;
  county?: string;
}) {
  const rows = parseSellerCsv(input.csv);
  if (!rows.length) throw new Error("The CSV did not contain any data rows.");
  return importSellerRows({
    rows,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    county: input.county,
    integrationType: "manual_csv",
  });
}

export async function updateSellerLead(id: string, input: { status?: SellerLeadStatus; note?: string; markDuplicate?: boolean }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server credentials are required to update leads.");

  if (input.status) {
    const { data: existing } = await supabase.from("seller_leads").select("status").eq("id", id).maybeSingle();
    const { error } = await supabase.from("seller_leads").update({
      status: input.status,
      updated_at: new Date().toISOString(),
      sent_to_deal_engine_at: input.status === "Sent to Deal Engine" ? new Date().toISOString() : undefined,
    }).eq("id", id);
    if (error) throw new Error(error.message);
    await supabase.from("lead_status_history").insert({ seller_lead_id: id, from_status: existing?.status ?? null, to_status: input.status });
  }
  if (input.note?.trim()) {
    const { error } = await supabase.from("lead_notes").insert({ seller_lead_id: id, note: input.note.trim() });
    if (error) throw new Error(error.message);
  }
  if (input.markDuplicate) {
    const { error } = await supabase.from("seller_leads").update({ status: "Dead Lead", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
  }
}

export async function updateSellerWeights(weights: SellerScoringWeights) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server credentials are required to update scoring weights.");
  await supabase.from("seller_scoring_settings").update({ active: false }).eq("active", true);
  const { error } = await supabase.from("seller_scoring_settings").insert({ name: "Operator settings", weights, active: true });
  if (error) throw new Error(error.message);
}

export async function listSellerSources() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data } = await supabase.from("data_sources").select("*").order("created_at", { ascending: false }).limit(100);
  return data ?? [];
}

export async function listBuyerCountyRegistrySources(includeInactive = true): Promise<BuyerCountyRegistryRow[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  let query = supabase
    .from("CountyDataSource")
    .select("id,county,state,source_type,source_url,active,notes,created_at")
    .not("source_url", "is", null)
    .order("county", { ascending: true });

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as BuyerCountyRegistryRow[];
}

async function getBuyerCountyRegistrySource(county: string, state = "NC"): Promise<BuyerCountyRegistryRow | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("CountyDataSource")
    .select("id,county,state,source_type,source_url,active,notes,created_at")
    .eq("county", county)
    .eq("state", state)
    .not("source_url", "is", null)
    .order("active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as BuyerCountyRegistryRow | null) ?? null;
}

export async function syncSellerSourcesFromBuyerRegistry() {
  const registryRows = await listBuyerCountyRegistrySources(true);
  const synced: Array<{ county: string; sourceUrl: string | null; active: boolean }> = [];

  for (const row of registryRows) {
    if (!row.source_url) continue;
    await createSellerSource({
      name: `${row.county} Buyer Registry Endpoint`,
      county: row.county,
      state: row.state,
      sourceType: "gis_property_data",
      sourceUrl: row.source_url,
      integrationType: "buyer_registry",
      active: row.active,
      configuration: {
        buyerRegistry: true,
        buyerSourceType: row.source_type,
        buyerRegistrySourceId: row.id,
        notes: row.notes,
      },
    });
    synced.push({ county: row.county, sourceUrl: row.source_url, active: row.active });
  }

  return { synced: synced.length, total: registryRows.length, rows: synced };
}

export async function createSellerSource(input: {
  name: string;
  county?: string;
  sourceType: string;
  sourceUrl?: string;
  integrationType?: string;
  state?: string;
  active?: boolean;
  configuration?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server credentials are required to create sources.");
  const integrationType = input.integrationType || "manual_csv";
  const configuration = input.configuration ?? {};
  const state = input.state || "NC";

  const { data: existing } = await supabase
    .from("data_sources")
    .select("*")
    .eq("name", input.name)
    .eq("county", input.county || null)
    .eq("state", state)
    .eq("source_type", input.sourceType)
    .eq("integration_type", integrationType)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("data_sources")
      .update({
        source_url: input.sourceUrl || null,
        configuration,
        active: input.active ?? true,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("data_sources")
    .insert({
      name: input.name,
      county: input.county || null,
      state,
      source_type: input.sourceType,
      source_url: input.sourceUrl || null,
      integration_type: integrationType,
      configuration,
      active: input.active ?? true,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function bootstrapSellerCountyStarterSources() {
  const created = [];
  for (const source of SELLER_COUNTY_STARTER_SOURCES) {
    created.push(await createSellerSource({
      name: source.name,
      county: source.county,
      state: source.state,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      integrationType: source.integrationType,
      active: true,
      configuration: { notes: source.notes, starterPack: true },
    }));
  }

  return {
    created: created.length,
    counties: [...new Set(SELLER_COUNTY_STARTER_SOURCES.map((source) => source.county))].sort(),
    sourceCount: SELLER_COUNTY_STARTER_SOURCES.length,
  };
}

export async function toggleSellerSourceActive(id: string, active: boolean) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server credentials are required to update sources.");
  const { error } = await supabase.from("data_sources").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

function normalizeArcGisText(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/,city,state zipcode/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNcOneMapOwnerName(attributes: NcOneMapAttributes) {
  return [normalizeArcGisText(attributes.ownname), normalizeArcGisText(attributes.ownlast)]
    .filter(Boolean)
    .join(" ")
    .trim() || "Unknown owner";
}

function normalizeNcOneMapPropertyAddress(attributes: NcOneMapAttributes) {
  return [
    normalizeArcGisText(attributes.saddno),
    normalizeArcGisText(attributes.saddpref),
    normalizeArcGisText(attributes.saddstr || attributes.saddstname),
    normalizeArcGisText(attributes.saddstsuf),
    normalizeArcGisText(attributes.saddsttyp),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function isCorporateOwnerName(value: string) {
  return NC_ONEMAP_CORPORATE_OWNER_PATTERN.test(value);
}

function normalizeArcGisDate(value: number | undefined) {
  if (!value || value <= 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) return "";
  return date.toISOString().slice(0, 10);
}

function parseIntegerDateValue(value: number | string | undefined) {
  const raw = String(value ?? "").trim();
  if (!/^\d{8}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (!year || !month || !day) return undefined;
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return timestamp;
}

function normalizeIntegerDate(value: number | string | undefined) {
  const timestamp = parseIntegerDateValue(value);
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

function stableSyntheticParcelId(parts: Array<string | undefined>) {
  const value = parts.map((part) => (part ?? "").trim().toUpperCase()).join("|");
  return createHash("sha1").update(value).digest("hex").slice(0, 16).toUpperCase();
}

function parseCityStateZipTail(value: string) {
  const match = value.trim().match(/\b([A-Z][A-Z .'-]+)\s+NC(?:\s+(\d{5}))?$/i);
  return {
    city: match?.[1]?.trim() ?? "",
    zip: match?.[2] ?? "",
  };
}

function extractXlsxSharedStrings(buffer: Buffer): XlsxSharedStrings {
  const content = buffer.toString("utf8");
  return Array.from(content.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)).map((entry) =>
    Array.from(entry[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((text) => decodeHtml(text[1]))
      .join(""),
  );
}

function extractXlsxRows(buffer: Buffer, sharedStrings: XlsxSharedStrings) {
  const content = buffer.toString("utf8");
  const rowMatches = Array.from(content.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g));

  return rowMatches.map((rowMatch) => {
    const cellValues: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const cellTag = cellMatch[1];
      const cellBody = cellMatch[2];
      const typeMatch = cellTag.match(/\bt="([^"]+)"/);
      const valueMatch = cellBody.match(/<v[^>]*>([\s\S]*?)<\/v>/);
      if (!valueMatch) {
        cellValues.push("");
        continue;
      }
      if (typeMatch?.[1] === "s") {
        cellValues.push(sharedStrings[Number(valueMatch[1])] ?? "");
      } else {
        cellValues.push(decodeHtml(valueMatch[1]));
      }
    }
    return cellValues;
  });
}

async function downloadMecklenburgXlsxRows(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Mecklenburg delinquent file fetch failed with status ${response.status}.`);
  const arrayBuffer = await response.arrayBuffer();
  const zipBuffer = Buffer.from(arrayBuffer);

  const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
  if (zipBuffer.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error("Mecklenburg delinquent file was not returned as a valid XLSX archive.");
  }

  const readZipEntry = (entryName: string) => {
    const endSignature = 0x06054b50;
    const centralSignature = 0x02014b50;
    const localSignature = 0x04034b50;

    let endOffset = -1;
    for (let index = zipBuffer.length - 22; index >= Math.max(0, zipBuffer.length - 65558); index -= 1) {
      if (zipBuffer.readUInt32LE(index) === endSignature) {
        endOffset = index;
        break;
      }
    }
    if (endOffset < 0) throw new Error("Mecklenburg workbook central directory was not found.");

    const centralDirectorySize = zipBuffer.readUInt32LE(endOffset + 12);
    const centralDirectoryOffset = zipBuffer.readUInt32LE(endOffset + 16);
    let pointer = centralDirectoryOffset;
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

    while (pointer < centralDirectoryEnd) {
      if (zipBuffer.readUInt32LE(pointer) !== centralSignature) {
        throw new Error("Mecklenburg workbook central directory entry was invalid.");
      }
      const compressionMethod = zipBuffer.readUInt16LE(pointer + 10);
      const compressedSize = zipBuffer.readUInt32LE(pointer + 20);
      const fileNameLength = zipBuffer.readUInt16LE(pointer + 28);
      const extraFieldLength = zipBuffer.readUInt16LE(pointer + 30);
      const commentLength = zipBuffer.readUInt16LE(pointer + 32);
      const localHeaderOffset = zipBuffer.readUInt32LE(pointer + 42);
      const fileName = zipBuffer.subarray(pointer + 46, pointer + 46 + fileNameLength).toString("utf8");

      if (fileName === entryName) {
        if (zipBuffer.readUInt32LE(localHeaderOffset) !== localSignature) {
          throw new Error(`Mecklenburg workbook local entry for ${entryName} was invalid.`);
        }
        const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) return compressedData;
        if (compressionMethod === 8) return inflateRawSync(compressedData);
        throw new Error(`Mecklenburg workbook entry ${entryName} uses unsupported compression method ${compressionMethod}.`);
      }

      pointer += 46 + fileNameLength + extraFieldLength + commentLength;
    }

    throw new Error(`Mecklenburg workbook entry ${entryName} was not found.`);
  };

  const sharedStrings = extractXlsxSharedStrings(readZipEntry("xl/sharedStrings.xml"));
  return extractXlsxRows(readZipEntry("xl/worksheets/sheet1.xml"), sharedStrings);
}

function yearsSince(value: number | undefined) {
  if (!value || value <= 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) return "";
  const now = new Date();
  let years = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) years -= 1;
  return String(Math.max(years, 0));
}

function parseYearsOwned(value: string | undefined) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "));
}

function normalizeSlashDate(value: string) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return value.trim();
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeAddressForComparison(value: string) {
  return value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function inferCityFromPropertyAddress(value: string, fallback: string) {
  const normalized = value.trim();
  const match = normalized.match(/,\s*([^,]+)\s*,\s*NC\b/i);
  if (match?.[1]) return match[1].trim();
  return fallback;
}

function rankSellerRows(rows: SellerImportRow[]): SellerImportRow[] {
  const rankedRows = rows
    .map((row) => {
      const yearsOwned = parseYearsOwned(row.years_owned);
      const assessedValue = numberOrNull(row.assessed_value) ?? 0;
      const hitCount = [
        yearsOwned >= 10,
        assessedValue >= NC_ONEMAP_HIGH_VALUE_MIN_ASSESSED,
        row.multiple_properties === "true",
        isCorporateOwnerName(row.owner_name),
      ].filter(Boolean).length;

      return {
        ...row,
        source_name: hitCount >= 2 ? "NC OneMap Motivated Seller Sweep" : row.source_name,
        motivation_profile_hits: String(hitCount),
      } as SellerImportRow;
    })
    .sort((left, right) => {
      const hitDelta = Number(right.motivation_profile_hits) - Number(left.motivation_profile_hits);
      if (hitDelta !== 0) return hitDelta;
      const rightYears = parseYearsOwned(right.years_owned);
      const leftYears = parseYearsOwned(left.years_owned);
      if (rightYears !== leftYears) return rightYears - leftYears;
      return (numberOrNull(right.assessed_value) ?? 0) - (numberOrNull(left.assessed_value) ?? 0);
    });

  return rankedRows;
}

function mergeSellerRowsByParcel(rows: SellerImportRow[]) {
  const merged = new Map<string, SellerImportRow>();

  for (const row of rows) {
    const key = `${row.county ?? ""}::${row.parcel_id ?? ""}::${row.property_address ?? ""}`.toUpperCase();
    if (!key.trim()) continue;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }

    const mergedHitCount = Math.max(
      Number(existing.motivation_profile_hits ?? "0"),
      Number(row.motivation_profile_hits ?? "0"),
    );
    merged.set(key, {
      ...existing,
      ...row,
      source_name: "NC OneMap Full Recon Sweep",
      multiple_properties: existing.multiple_properties === "true" || row.multiple_properties === "true" ? "true" : "false",
      owner_occupancy_status: [existing.owner_occupancy_status, row.owner_occupancy_status].filter(Boolean).join(" / "),
      motivation_profile_hits: String(mergedHitCount),
    });
  }

  return Array.from(merged.values());
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

async function fetchNcOneMapAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const needsPostFilterExpansion = input.sourceKey === "nc_onemap_portfolio_absentee_search"
    || input.sourceKey === "nc_onemap_corporate_absentee_search"
    || input.sourceKey === "nc_onemap_legacy_portfolio_absentee_search"
    || input.sourceKey === "nc_onemap_motivated_seller_sweep";
  const queryLimit = needsPostFilterExpansion ? Math.min(Math.max(requestedLimit * 4, 40), 100) : requestedLimit;
  const where = [
    `cntyname='${input.county.replace(/'/g, "''")}'`,
    "mstate <> 'NC'",
    "struct='Y'",
    "parusedsc2 LIKE 'RES%'",
  ];
  if (input.sourceKey === "nc_onemap_legacy_absentee_search") {
    where.push(`saledate IS NOT NULL`);
    where.push(`saledate <= DATE '${NC_ONEMAP_LEGACY_ABSENTEE_MAX_SALEDATE}'`);
  }
  if (input.sourceKey === "nc_onemap_high_value_absentee_search") {
    where.push(`parval >= ${NC_ONEMAP_HIGH_VALUE_MIN_ASSESSED}`);
  }
  if (input.sourceKey === "nc_onemap_legacy_portfolio_absentee_search") {
    where.push(`saledate IS NOT NULL`);
    where.push(`saledate <= DATE '${NC_ONEMAP_LEGACY_ABSENTEE_MAX_SALEDATE}'`);
  }
  if (input.city?.trim()) where.push(`scity='${input.city.trim().replace(/'/g, "''")}'`);

  const params = new URLSearchParams({
    where: where.join(" AND "),
    outFields: [
      "parno",
      "ownname",
      "ownlast",
      "mailadd",
      "mcity",
      "mstate",
      "mzip",
      "saddno",
      "saddpref",
      "saddstname",
      "saddstr",
      "saddstsuf",
      "saddsttyp",
      "scity",
      "szip",
      "parval",
      "saledate",
      "cntyname",
      "parusedesc",
      "parusedsc2",
      "gisacres",
    ].join(","),
    returnGeometry: "false",
    resultRecordCount: String(queryLimit),
    orderByFields: "saledate ASC",
    f: "json",
  });

  const endpoint =
    "https://services.arcgis.com/04HiymDgLlsbhaV4/arcgis/rest/services/NCOneMap_Parcels/FeatureServer/79/query";
  const response = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`NC OneMap search failed with status ${response.status}.`);
  const payload = await response.json() as {
    error?: { message?: string };
    features?: Array<{ attributes?: NcOneMapAttributes }>;
  };
  if (payload.error?.message) throw new Error(payload.error.message);

  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .map((attributes) => {
      const propertyAddress = normalizeNcOneMapPropertyAddress(attributes);
      const ownerName = normalizeNcOneMapOwnerName(attributes);
      const ownerMailingAddress = [
        normalizeArcGisText(attributes.mailadd),
        normalizeArcGisText(attributes.mcity),
        normalizeArcGisText(attributes.mstate),
        normalizeArcGisText(attributes.mzip),
      ]
        .filter(Boolean)
        .join(", ");

      return {
        property_address: propertyAddress,
        parcel_id: normalizeArcGisText(attributes.parno),
        county: normalizeArcGisText(attributes.cntyname),
        city: normalizeArcGisText(attributes.scity).replace("MECKLENBURG COUNTY-UNINCORPORATED", "Mecklenburg County"),
        zip_code: normalizeArcGisText(attributes.szip),
        property_type: normalizeArcGisText(attributes.parusedesc || attributes.parusedsc2),
        assessed_value: attributes.parval ? String(Math.round(attributes.parval)) : "",
        last_sale_date: normalizeArcGisDate(attributes.saledate),
        last_sale_price: "",
        owner_name: ownerName,
        owner_mailing_address: ownerMailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.saledate),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "NC OneMap Live Absentee Search",
      };
    })
    .filter((row) => row.property_address && row.parcel_id);

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    if (!key) return counts;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  const enrichedRows = rows.map((row) => {
    const ownerKey = row.owner_name.trim().toUpperCase();
    const multipleProperties = ownerKey ? (ownerCounts[ownerKey] ?? 0) > 1 : false;

    return {
      ...row,
      multiple_properties: multipleProperties ? "true" : "false",
    };
  });

  const rankedRows = rankSellerRows(enrichedRows);

  if (input.sourceKey === "nc_onemap_portfolio_absentee_search") {
    return rankedRows.filter((row) => row.multiple_properties === "true").slice(0, requestedLimit);
  }

  if (input.sourceKey === "nc_onemap_corporate_absentee_search") {
    return rankedRows.filter((row) => isCorporateOwnerName(row.owner_name)).slice(0, requestedLimit);
  }

  if (input.sourceKey === "nc_onemap_legacy_portfolio_absentee_search") {
    return rankedRows.filter((row) => row.multiple_properties === "true").slice(0, requestedLimit);
  }

  if (input.sourceKey === "nc_onemap_motivated_seller_sweep") {
    return rankedRows.filter((row) => Number(row.motivation_profile_hits) >= 2).slice(0, requestedLimit);
  }

  return rankedRows.slice(0, requestedLimit);
}

async function fetchCumberlandForeclosureRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const response = await fetch("https://www.cumberlandcountync.gov/departments/tax-group/tax/tax-foreclosure-sales", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Cumberland foreclosure fetch failed with status ${response.status}.`);
  const html = await response.text();

  const rowPattern = /<tr[^>]*class="table-item-row"[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const rows: SellerImportRow[] = [];

  for (const rowMatch of html.matchAll(rowPattern)) {
    const cells = [...rowMatch[1].matchAll(cellPattern)].map((match) => stripHtml(match[1]));
    if (cells.length < 5) continue;
    const [ownerName, propertyLocation, parcelNumber, billNumber, saleDate] = cells;
    if (!ownerName || !parcelNumber) continue;

    rows.push({
      property_address: propertyLocation || "Foreclosure property",
      parcel_id: parcelNumber,
      county: "Cumberland",
      city: input.city?.trim() || "Fayetteville",
      zip_code: "",
      property_type: "Foreclosure",
      assessed_value: "",
      last_sale_date: "",
      last_sale_price: "",
      owner_name: ownerName,
      owner_mailing_address: "",
      owner_occupancy_status: "Unknown",
      tax_delinquent: "true",
      foreclosure: "true",
      probate: "false",
      vacant: "false",
      code_violation: "false",
      years_owned: "",
      estimated_equity: "",
      source_name: "Cumberland County Foreclosure Sales",
      bill_number: billNumber,
      scheduled_sale_date: saleDate,
    });
  }

  return rows.slice(0, limit);
}

async function fetchCumberlandDelinquentTaxRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const response = await fetch("https://www.cumberlandcountync.gov/CustomContent/tax/delinquent_taxes/delinquent_taxes.aspx?TaxDelinquent_GVChangePage=91_20", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Cumberland delinquent tax fetch failed with status ${response.status}.`);
  const html = await response.text();

  const rowPattern = /<tr class="rg(?:Alt)?Row"[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const rows: SellerImportRow[] = [];

  for (const rowMatch of html.matchAll(rowPattern)) {
    const cells = [...rowMatch[1].matchAll(cellPattern)].map((match) => stripHtml(match[1]));
    if (cells.length < 5) continue;
    const [billNumber, ownerName, secondaryOwnerName, landDescription, amount] = cells;
    if (!billNumber || !ownerName || !landDescription) continue;

    rows.push({
      property_address: landDescription,
      parcel_id: `CUMBERLAND-DELINQ-${billNumber}`,
      county: "Cumberland",
      city: input.city?.trim() || "Fayetteville",
      zip_code: "",
      property_type: "Tax Delinquent",
      assessed_value: "",
      last_sale_date: "",
      last_sale_price: "",
      owner_name: [ownerName, secondaryOwnerName].filter((value) => value && value !== "&").join(" / "),
      owner_mailing_address: "",
      owner_occupancy_status: "Unknown",
      tax_delinquent: "true",
      foreclosure: "false",
      probate: "false",
      vacant: "false",
      code_violation: "false",
      years_owned: "",
      estimated_equity: "",
      source_name: "Cumberland County Delinquent Taxes",
      bill_number: billNumber,
      delinquent_amount: amount.replace(/[^0-9.]/g, ""),
    });
  }

  return rows.slice(0, limit);
}

async function fetchForsythForeclosureRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const response = await fetch("https://co.forsyth.nc.us/tax/foreclosure_prop.aspx", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Forsyth foreclosure fetch failed with status ${response.status}.`);
  const html = await response.text();

  const panelPattern = /<div class="panel panel-blue">([\s\S]*?)<\/table>[\s\S]*?<\/div>[\s\S]*?<\/div>/gi;
  const headingPattern = /<h4[^>]*>[\s\S]*?<\/i>([\s\S]*?)<\/h4>/i;
  const casePattern = /Case Number:\s*([^<]+)/i;
  const rowPattern = /<tr>\s*<td>([^<]+):<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  const rows: SellerImportRow[] = [];

  for (const panelMatch of html.matchAll(panelPattern)) {
    const panelHtml = panelMatch[1];
    const heading = stripHtml(panelHtml.match(headingPattern)?.[1] ?? "");
    const caseNumber = stripHtml(panelHtml.match(casePattern)?.[1] ?? "");
    const fields = new Map<string, string>();

    for (const fieldMatch of panelHtml.matchAll(rowPattern)) {
      fields.set(stripHtml(fieldMatch[1]), stripHtml(fieldMatch[2]));
    }

    const ownerName = fields.get("Owner") ?? "";
    const parcelId = fields.get("PIN") ?? "";
    if (!ownerName || !parcelId) continue;

    rows.push({
      property_address: fields.get("Description") || heading || "Foreclosure property",
      parcel_id: parcelId,
      county: "Forsyth",
      city: input.city?.trim() || "Winston-Salem",
      zip_code: "",
      property_type: "Foreclosure",
      assessed_value: (fields.get("Tax Value") ?? "").replace(/[^0-9.]/g, ""),
      last_sale_date: "",
      last_sale_price: "",
      owner_name: ownerName,
      owner_mailing_address: "",
      owner_occupancy_status: "Unknown",
      tax_delinquent: "false",
      foreclosure: "true",
      probate: "false",
      vacant: "false",
      code_violation: "false",
      years_owned: "",
      estimated_equity: "",
      source_name: "Forsyth County Foreclosure Sales",
      case_number: caseNumber,
      foreclosure_status: fields.get("Status") ?? "",
      sale_date: fields.get("Sale Date & Time") ?? "",
      sale_location: fields.get("Sale Location") ?? "",
      attorney: fields.get("Attorney") ?? "",
      min_bid: (fields.get("Min Bid") ?? "").replace(/[^0-9.]/g, ""),
    });
  }

  return rows.slice(0, limit);
}

async function fetchGuilfordForeclosureRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const params = new URLSearchParams({
    where: "1=1",
    outFields: [
      "Owner",
      "LOCATION_ADDR",
      "Total_Assessed",
      "PARCEL_ID",
      "FLAG_STATUS",
      "AuctionDate",
      "AuctionTime",
      "AuctionLocation",
      "Mail_Address",
      "Mail_City",
      "Mail_State",
      "Mail_Zip",
      "Property_Type",
      "DEED_DATE",
      "PIN",
      "REID",
      "PROPERTY_DESCR",
    ].join(","),
    returnGeometry: "false",
    resultRecordCount: String(Math.min(Math.max(limit * 2, 25), 200)),
    orderByFields: "AuctionDate ASC, FLAG_STATUS ASC, Total_Assessed DESC",
    f: "json",
  });

  const endpoint =
    "https://gcgis.guilfordcountync.gov/arcgis/rest/services/Foreclosure/ForeclosuresPublic/FeatureServer/0/query";
  const response = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Guilford foreclosure fetch failed with status ${response.status}.`);
  const payload = await response.json() as {
    error?: { message?: string };
    features?: Array<{ attributes?: GuilfordForeclosureAttributes }>;
  };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .map((attributes) => {
      const mailingAddress = [
        normalizeArcGisText(attributes.Mail_Address),
        normalizeArcGisText(attributes.Mail_City),
        normalizeArcGisText(attributes.Mail_State),
        normalizeArcGisText(attributes.Mail_Zip),
      ]
        .filter(Boolean)
        .join(", ");
      const propertyAddress = normalizeArcGisText(attributes.LOCATION_ADDR);
      const mailingCity = normalizeArcGisText(attributes.Mail_City);
      const propertyCity = input.city?.trim() || mailingCity || "Guilford County";

      return {
        property_address: propertyAddress || normalizeArcGisText(attributes.PROPERTY_DESCR) || "Foreclosure property",
        parcel_id: normalizeArcGisText(attributes.PIN || attributes.PARCEL_ID || attributes.REID),
        county: "Guilford",
        city: propertyCity,
        zip_code: "",
        property_type: normalizeArcGisText(attributes.Property_Type) || "Foreclosure",
        assessed_value: attributes.Total_Assessed ? String(Math.round(attributes.Total_Assessed)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DEED_DATE),
        last_sale_price: "",
        owner_name: normalizeArcGisText(attributes.Owner) || "Unknown owner",
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: normalizeArcGisText(attributes.Mail_State)?.toUpperCase() === "NC" ? "Unknown" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "true",
        probate: "false",
        vacant: "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DEED_DATE),
        estimated_equity: "",
        source_name: "Guilford County Foreclosure Research",
        foreclosure_status: normalizeArcGisText(attributes.FLAG_STATUS),
        auction_date: normalizeArcGisDate(attributes.AuctionDate),
        auction_time: normalizeArcGisText(attributes.AuctionTime),
        auction_location: normalizeArcGisText(attributes.AuctionLocation),
      };
    })
    .filter((row) => row.parcel_id && row.property_address)
    .filter((row) => {
      if (!cityFilter) return true;
      return row.city.toUpperCase().includes(cityFilter)
        || row.property_address.toUpperCase().includes(cityFilter);
    });

  return rows.slice(0, limit);
}

async function fetchMecklenburgForeclosureRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const response = await fetch("https://www.rbcwb.com/wp-json/wp/v2/pages/667", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mecklenburg foreclosure feed fetch failed with status ${response.status}.`);
  const payload = await response.json() as { content?: { rendered?: string } };
  const html = payload.content?.rendered ?? "";

  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const cityFilter = input.city?.trim().toUpperCase();
  const rows: SellerImportRow[] = [];

  for (const rowMatch of html.matchAll(rowPattern)) {
    const cells = [...rowMatch[1].matchAll(cellPattern)].map((match) => stripHtml(match[1]));
    if (cells.length < 7) continue;
    const [ownerName, propertyAddress, zipCode, parcelId, courtFile, status, lastDayForUpset] = cells;
    if (!ownerName || !propertyAddress || ownerName.toUpperCase() === "NAME" || parcelId.toUpperCase().includes("PARCEL#")) {
      continue;
    }

    const city = input.city?.trim() || "Charlotte";
    const normalizedStatus = status.trim();
    rows.push({
      property_address: propertyAddress,
      parcel_id: parcelId,
      county: "Mecklenburg",
      city,
      zip_code: zipCode,
      property_type: /vacant lot/i.test(propertyAddress) ? "Vacant Lot" : "Foreclosure",
      assessed_value: "",
      last_sale_date: "",
      last_sale_price: "",
      owner_name: ownerName,
      owner_mailing_address: "",
      owner_occupancy_status: "Unknown",
      tax_delinquent: "false",
      foreclosure: "true",
      probate: /heirs/i.test(ownerName) ? "true" : "false",
      vacant: /vacant lot/i.test(propertyAddress) ? "true" : "false",
      code_violation: "false",
      years_owned: "",
      estimated_equity: "",
      source_name: "Mecklenburg County Foreclosure Properties",
      court_file: courtFile,
      foreclosure_status: normalizedStatus,
      upset_bid_deadline: lastDayForUpset ? normalizeSlashDate(lastDayForUpset) : "",
    });
  }

  return rows
    .filter((row) => {
      if (!cityFilter) return true;
      return row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter);
    })
    .slice(0, limit);
}

async function fetchWakeCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const pageSize = Math.min(Math.max(requestedLimit * 4, 100), 500);
  const maxPages = 4;
  const rows: SellerImportRow[] = [];
  const cityFilter = input.city?.trim().toUpperCase();
  const endpoint = (await getBuyerCountyRegistrySource("Wake"))?.source_url?.split("?")[0]
    || "https://maps.wake.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query";

  for (let page = 0; page < maxPages && rows.length < requestedLimit * 2; page += 1) {
    const params = new URLSearchParams({
      where: "TOTSALPRICE > 0 AND SITE_ADDRESS IS NOT NULL AND LAND_CLASS LIKE 'R%'",
      outFields: [
        "PIN_NUM",
        "REID",
        "OWNER",
        "ADDR1",
        "ADDR2",
        "ADDR3",
        "DEED_BOOK",
        "DEED_PAGE",
        "DEED_DATE",
        "TOTAL_VALUE_ASSD",
        "SITE_ADDRESS",
        "CITY_DECODE",
        "YEAR_BUILT",
        "TOTSALPRICE",
        "SALE_DATE",
        "TYPE_USE_DECODE",
        "LAND_CLASS",
        "LAND_CLASS_DECODE",
      ].join(","),
      returnGeometry: "false",
      orderByFields: "SALE_DATE DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await postArcgisQueryWithTimeout(endpoint, params, 20000) as {
      error?: { message?: string };
      features?: Array<{ attributes?: WakeParcelAttributes }>;
    };
    if (payload.error?.message) throw new Error(payload.error.message);

    const pageRows = (payload.features ?? []).map((feature) => feature.attributes ?? {});
    if (!pageRows.length) break;

    for (const attributes of pageRows) {
      const propertyAddress = normalizeArcGisText(attributes.SITE_ADDRESS);
      const mailingLine1 = normalizeArcGisText(attributes.ADDR1);
      const mailingLine2 = normalizeArcGisText(attributes.ADDR2);
      const mailingLine3 = normalizeArcGisText(attributes.ADDR3);
      const ownerName = normalizeArcGisText(attributes.OWNER);
      const parcelId = normalizeArcGisText(attributes.PIN_NUM || attributes.REID);
      const propertyCity = normalizeArcGisText(attributes.CITY_DECODE) || input.city?.trim() || "Wake County";
      const propertyStreetKey = normalizeAddressForComparison(propertyAddress);
      const mailingStreetKey = normalizeAddressForComparison(mailingLine1);
      const mailingAddress = [mailingLine1, mailingLine2, mailingLine3].filter(Boolean).join(", ");
      const absentee = Boolean(propertyStreetKey && mailingStreetKey && propertyStreetKey !== mailingStreetKey);

      if (!ownerName || !parcelId || !propertyAddress || !absentee) continue;
      if (cityFilter && propertyCity.toUpperCase() !== cityFilter) continue;

      rows.push({
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Wake",
        city: propertyCity,
        zip_code: normalizeArcGisText(mailingLine2.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1]),
        property_type: normalizeArcGisText(attributes.TYPE_USE_DECODE || attributes.LAND_CLASS_DECODE || attributes.LAND_CLASS),
        assessed_value: attributes.TOTAL_VALUE_ASSD ? String(Math.round(attributes.TOTAL_VALUE_ASSD)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DEED_DATE || attributes.SALE_DATE),
        last_sale_price: attributes.TOTSALPRICE ? String(Math.round(attributes.TOTSALPRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: /VACANT|LAND/i.test(normalizeArcGisText(attributes.TYPE_USE_DECODE || attributes.LAND_CLASS_DECODE || "")) ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DEED_DATE || attributes.SALE_DATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Wake County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DEED_BOOK), normalizeArcGisText(attributes.DEED_PAGE)].filter(Boolean).join("/"),
        year_built: attributes.YEAR_BUILT ? String(attributes.YEAR_BUILT) : "",
      });
    }

    if (pageRows.length < pageSize) break;
  }

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    if (!key) return counts;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return rankSellerRows(
    rows.map((row) => ({
      ...row,
      multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false",
    })),
  ).slice(0, requestedLimit);
}

async function fetchBeaufortCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Beaufort"))?.source_url?.split("?")[0]
    || "https://services1.arcgis.com/oXsk9nimtmSEU8Ko/arcgis/rest/services/Beaufort_Service/FeatureServer/4/query";
  const params = new URLSearchParams({
    where: "SALE_PRICE > 0 AND PROP_ADDR IS NOT NULL",
    outFields: "REID,GPIN,GPINLONG,NAME1,NAME2,ADDR1,ADDR2,CITY,STATE,ZIP,PROP_DESC,LAND_VAL,BLDG_VAL,TOT_VAL,ACRES,PROP_ADDR,DATE,SALE_PRICE,NBR_BLDG,LAND_USE,YR_BUILT,DB_PG,DEED_BOOK,DEED_PAGE,date_dt",
    returnGeometry: "false",
    orderByFields: "date_dt DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Beaufort absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: BeaufortParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PROP_ADDR);
      const mailingAddress = [
        normalizeArcGisText(attributes.ADDR1),
        normalizeArcGisText(attributes.ADDR2),
        normalizeArcGisText(attributes.CITY),
        normalizeArcGisText(attributes.STATE),
        normalizeArcGisText(attributes.ZIP),
      ].filter(Boolean).join(", ");
      const ownerName = [normalizeArcGisText(attributes.NAME1), normalizeArcGisText(attributes.NAME2)].filter(Boolean).join(" / ");
      const parcelId = normalizeArcGisText(attributes.GPIN || attributes.GPINLONG || attributes.REID);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Beaufort County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.ADDR1));
      if (!propertyAddress || !mailingAddress || !ownerName || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Beaufort",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.ZIP),
        property_type: normalizeArcGisText(attributes.LAND_USE || attributes.PROP_DESC) || "Property",
        assessed_value: attributes.TOT_VAL ? String(Math.round(attributes.TOT_VAL)) : "",
        last_sale_date: normalizeArcGisDate(attributes.date_dt),
        last_sale_price: attributes.SALE_PRICE ? String(Math.round(attributes.SALE_PRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.NBR_BLDG || attributes.BLDG_VAL === 0 ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.date_dt),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Beaufort County Absentee Owners",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchGranvilleCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Granville"))?.source_url?.split("?")[0]
    || "https://services8.arcgis.com/dT3Tew5pivPd2bWH/arcgis/rest/services/Granville_Service/FeatureServer/8/query";
  const params = new URLSearchParams({
    where: "SalePrice > 0 AND FormattedPropertyAddress IS NOT NULL",
    outFields: "PIN,MAPN,PRODNO,RECN,Parcel,OwnerName1,OwnerName2,AddressLine1,AddressLine2,AddressLine3,City,State,Zip,FormattedPropertyAddress,LegalDescription,DeedDate,DeedBookPage,BuildingValue,LandValue,AssessedValue,MarketValue,SalePrice,PRC",
    returnGeometry: "false",
    orderByFields: "DeedDate DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Granville absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: GranvilleParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.FormattedPropertyAddress);
      const mailingAddress = [
        normalizeArcGisText(attributes.AddressLine1),
        normalizeArcGisText(attributes.AddressLine2),
        normalizeArcGisText(attributes.AddressLine3),
        normalizeArcGisText(attributes.City),
        normalizeArcGisText(attributes.State),
        normalizeArcGisText(attributes.Zip),
      ].filter(Boolean).join(", ");
      const ownerName = [normalizeArcGisText(attributes.OwnerName1), normalizeArcGisText(attributes.OwnerName2)].filter(Boolean).join(" / ");
      const parcelId = normalizeArcGisText(attributes.PIN || attributes.Parcel || attributes.RECN);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Granville County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.AddressLine1));
      if (!propertyAddress || !mailingAddress || !ownerName || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Granville",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.Zip),
        property_type: normalizeArcGisText(attributes.PRC || attributes.LegalDescription) || "Property",
        assessed_value: attributes.AssessedValue ? String(Math.round(attributes.AssessedValue)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DeedDate),
        last_sale_price: attributes.SalePrice ? String(Math.round(attributes.SalePrice)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: attributes.BuildingValue === 0 ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DeedDate),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Granville County Absentee Owners",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchSampsonCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Sampson"))?.source_url?.split("?")[0]
    || "https://services3.arcgis.com/fM4kjZmPOS4ay2Ff/arcgis/rest/services/Parcels/FeatureServer/0/query";
  const params = new URLSearchParams({
    where: "SALE_PRICE > 0 AND PARCEL_ADD IS NOT NULL",
    outFields: "PIN,CURRENT_OW,CURRENT_AD,CURRENT_CI,CURRENT_ST,CURRENT_ZI,BK_PG,SALE_PRICE,DATE_RECOR,PARCEL_ADD,SEG_TYPE_D,USE_DESC,ASSESSED_V,PARCEL_CLA,DEED,YEAR_BUILT",
    returnGeometry: "false",
    orderByFields: "DATE_RECOR DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Sampson absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: SampsonParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PARCEL_ADD);
      const mailingAddress = [
        normalizeArcGisText(attributes.CURRENT_AD),
        normalizeArcGisText(attributes.CURRENT_CI),
        normalizeArcGisText(attributes.CURRENT_ST),
        normalizeArcGisText(attributes.CURRENT_ZI),
      ].filter(Boolean).join(", ");
      const ownerName = normalizeArcGisText(attributes.CURRENT_OW);
      const parcelId = normalizeArcGisText(attributes.PIN);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Sampson County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.CURRENT_AD));
      if (!propertyAddress || !mailingAddress || !ownerName || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Sampson",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.CURRENT_ZI),
        property_type: normalizeArcGisText(attributes.USE_DESC || attributes.PARCEL_CLA || attributes.SEG_TYPE_D) || "Property",
        assessed_value: attributes.ASSESSED_V ? String(Math.round(attributes.ASSESSED_V)) : "",
        last_sale_date: attributes.DATE_RECOR ? String(attributes.DATE_RECOR).slice(0, 10) : "",
        last_sale_price: attributes.SALE_PRICE ? String(Math.round(attributes.SALE_PRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: /VACANT|LAND/i.test(normalizeArcGisText(attributes.USE_DESC || attributes.PARCEL_CLA || "")) ? "true" : "false",
        code_violation: "false",
        years_owned: attributes.DATE_RECOR ? yearsSince(Date.parse(attributes.DATE_RECOR)) : "",
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Sampson County Absentee Owners",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchStokesCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Stokes"))?.source_url?.split("?")[0]
    || "https://stokescountygis.com/server/rest/services/ParcelsNew/MapServer/2/query";
  const params = new URLSearchParams({
    where: "1=1",
    outFields: [
      "PARCEL_NUMBER",
      "PIN",
      "PARCEL_DESCRIPTION",
      "PHYSICAL_ADDRESS",
      "LAND_CLASS",
      "PROPERTY_OWNER_1",
      "PROPERTY_OWNER_2",
      "OWNER_MAIL_ADDR_1",
      "OWNER_MAIL_ADDR_2",
      "OWNER_MAIL_ADDR_3",
      "OWNER_MAIL_ADDR_CITY",
      "OWNER_MAIL_ADDR_STATE",
      "OWNER_MAIL_ADDR_ZIP",
      "PHYS_ADDR_CITY",
      "PHYS_ADDR_STATE",
      "PHYS_ADDR_ZIP",
      "DEED_DATE",
      "DEED_BOOK",
      "DEED_PAGE",
      "DEED_BKPG",
    ].join(","),
    returnGeometry: "false",
    orderByFields: "DEED_DATE DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Stokes absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: StokesParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PHYSICAL_ADDRESS);
      const ownerName = [normalizeArcGisText(attributes.PROPERTY_OWNER_1), normalizeArcGisText(attributes.PROPERTY_OWNER_2)].filter(Boolean).join(" / ");
      const mailingAddress = [
        normalizeArcGisText(attributes.OWNER_MAIL_ADDR_1),
        normalizeArcGisText(attributes.OWNER_MAIL_ADDR_2),
        normalizeArcGisText(attributes.OWNER_MAIL_ADDR_3),
        normalizeArcGisText(attributes.OWNER_MAIL_ADDR_CITY),
        normalizeArcGisText(attributes.OWNER_MAIL_ADDR_STATE),
        normalizeArcGisText(attributes.OWNER_MAIL_ADDR_ZIP),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN || attributes.PARCEL_NUMBER);
      const propertyCity = normalizeArcGisText(attributes.PHYS_ADDR_CITY) || input.city?.trim() || "Stokes County";
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.OWNER_MAIL_ADDR_1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];
      if (cityFilter && propertyCity.toUpperCase() !== cityFilter) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Stokes",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.PHYS_ADDR_ZIP),
        property_type: normalizeArcGisText(attributes.LAND_CLASS || attributes.PARCEL_DESCRIPTION) || "Property",
        assessed_value: "",
        last_sale_date: normalizeArcGisDate(attributes.DEED_DATE),
        last_sale_price: "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: /VACANT|LAND/i.test(normalizeArcGisText(attributes.LAND_CLASS || "")) ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DEED_DATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Stokes County Absentee Owners",
        deed_reference: normalizeArcGisText(attributes.DEED_BKPG) || [normalizeArcGisText(attributes.DEED_BOOK), normalizeArcGisText(attributes.DEED_PAGE)].filter(Boolean).join("/"),
      } satisfies SellerImportRow];
    });

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchStanlyCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Stanly"))?.source_url?.split("?")[0]
    || "https://services6.arcgis.com/w1igg0Q14weqYXUh/arcgis/rest/services/parcel_records_base_2/FeatureServer/3/query";
  const params = new URLSearchParams({
    where: "DateSold IS NOT NULL AND PhyStreetAddr IS NOT NULL",
    outFields: "PIN,Name1,Name2,Name3,TaxPayerAddr1,TaxPayerAddr2,TaxPayerCity,State,Zip,PhyStreetAddr,DateSold,SaleAmount,DeedBook,DeedPage,YearBuilt,TotalASVCurrent,Description1",
    returnGeometry: "false",
    orderByFields: "DateSold DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Stanly absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: StanlyParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PhyStreetAddr);
      const ownerName = [
        normalizeArcGisText(attributes.Name1),
        normalizeArcGisText(attributes.Name2),
        normalizeArcGisText(attributes.Name3),
      ].filter(Boolean).join(" / ");
      const mailingAddress = [
        normalizeArcGisText(attributes.TaxPayerAddr1),
        normalizeArcGisText(attributes.TaxPayerAddr2),
        normalizeArcGisText(attributes.TaxPayerCity),
        normalizeArcGisText(attributes.State),
        normalizeArcGisText(attributes.Zip),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Stanly County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.TaxPayerAddr1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Stanly",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.Zip),
        property_type: normalizeArcGisText(attributes.Description1) || "Property",
        assessed_value: attributes.TotalASVCurrent ? String(Math.round(attributes.TotalASVCurrent)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DateSold),
        last_sale_price: attributes.SaleAmount ? String(Math.round(attributes.SaleAmount)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: /VACANT|LAND/i.test(normalizeArcGisText(attributes.Description1 || "")) ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DateSold),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Stanly County Absentee Owners",
        deed_reference: [attributes.DeedBook, attributes.DeedPage].filter((part) => part !== null && part !== undefined && String(part).trim()).join("/"),
        year_built: attributes.YearBuilt ? String(attributes.YearBuilt) : "",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchWilkesCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Wilkes"))?.source_url?.split("?")[0]
    || "https://gis.wilkescounty.net/arcgis/rest/services/Parcels_Data/MapServer/0/query";
  const params = new URLSearchParams({
    where: "SALEDATE IS NOT NULL AND PROPLOCAT IS NOT NULL",
    outFields: "PARCEL_ID,OWNER1,MAILADD1,MAILADD2,CITY,STATE,ZIP,PIN,PROPLOCAT,COSTLANDVA,COSTBLDGVA,COSTTOTVA,LANDTYPE,YEARBUILT,EFFYEARBLT,SALEPRICE,SALE_VALIDITY,SALETYPE,SALEDATE,BOOK_PAGE",
    returnGeometry: "false",
    orderByFields: "SALEDATE DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Wilkes absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: WilkesParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PROPLOCAT);
      const ownerName = normalizeArcGisText(attributes.OWNER1);
      const mailingAddress = [
        normalizeArcGisText(attributes.MAILADD1),
        normalizeArcGisText(attributes.MAILADD2),
        normalizeArcGisText(attributes.CITY),
        normalizeArcGisText(attributes.STATE),
        normalizeArcGisText(attributes.ZIP),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN || attributes.PARCEL_ID);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Wilkes County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.MAILADD1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Wilkes",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.ZIP),
        property_type: normalizeArcGisText(attributes.LANDTYPE) || "Property",
        assessed_value: attributes.COSTTOTVA ? String(Math.round(attributes.COSTTOTVA)) : "",
        last_sale_date: normalizeArcGisDate(attributes.SALEDATE),
        last_sale_price: attributes.SALEPRICE ? String(Math.round(attributes.SALEPRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.COSTBLDGVA || /VACANT|LAND/i.test(normalizeArcGisText(attributes.LANDTYPE || "")) ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.SALEDATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Wilkes County Absentee Owners",
        deed_reference: normalizeArcGisText(attributes.BOOK_PAGE),
        year_built: attributes.YEARBUILT ? String(attributes.YEARBUILT) : "",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchWarrenCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Warren"))?.source_url?.split("?")[0]
    || "https://arcgis4.roktech.net/arcgis/rest/services/Warren/RokMap/MapServer/4/query";
  const params = new URLSearchParams({
    where: "DEEDDATE IS NOT NULL AND SITUS_ADDRESS IS NOT NULL",
    outFields: "NEWPIN,MAPN,NAME1,NAME2,ADDR,CITY,STATE,ZIP,SITUS_ADDRESS,SALE_PRICE,DEEDDATE,DEEDBOOK,DEEDPAGE",
    returnGeometry: "false",
    orderByFields: "DEEDDATE DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Warren absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: WarrenParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.SITUS_ADDRESS);
      const ownerName = [normalizeArcGisText(attributes.NAME1), normalizeArcGisText(attributes.NAME2)].filter(Boolean).join(" / ");
      const mailingAddress = [
        normalizeArcGisText(attributes.ADDR),
        normalizeArcGisText(attributes.CITY),
        normalizeArcGisText(attributes.STATE),
        normalizeArcGisText(attributes.ZIP),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.NEWPIN || attributes.MAPN);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Warren County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.ADDR));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Warren",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.ZIP),
        property_type: "Property",
        assessed_value: "",
        last_sale_date: normalizeArcGisDate(attributes.DEEDDATE),
        last_sale_price: attributes.SALE_PRICE ? String(Math.round(attributes.SALE_PRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DEEDDATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Warren County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DEEDBOOK), normalizeArcGisText(attributes.DEEDPAGE)].filter(Boolean).join("/"),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchRobesonCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Robeson"))?.source_url?.split("?")[0]
    || "https://arcgis4.roktech.net/arcgis/rest/services/robeson/ROKMAPS_v2/MapServer/15/query";
  const params = new URLSearchParams({
    where: "DATESOLD IS NOT NULL AND PHYSTRADR IS NOT NULL",
    outFields: "PIN_NUMBER,OWNAM1,OWNAM2,OWCITY,OWSTATE,OWZIP,PHYSTRADR,DATESOLD,SALEAMT,DEEDBOOK,DEEDPAGE",
    returnGeometry: "false",
    orderByFields: "DATESOLD DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Robeson absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: RobesonParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PHYSTRADR);
      const ownerName = [normalizeArcGisText(attributes.OWNAM1), normalizeArcGisText(attributes.OWNAM2)].filter(Boolean).join(" / ");
      const mailingAddress = [
        normalizeArcGisText(attributes.OWCITY),
        normalizeArcGisText(attributes.OWSTATE),
        normalizeArcGisText(attributes.OWZIP),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN_NUMBER);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Robeson County");
      const absentee = !normalizeAddressForComparison(mailingAddress).includes(normalizeAddressForComparison(propertyAddress));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Robeson",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.OWZIP),
        property_type: "Property",
        assessed_value: "",
        last_sale_date: normalizeIntegerDate(attributes.DATESOLD),
        last_sale_price: attributes.SALEAMT ? String(Math.round(attributes.SALEAMT)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: "false",
        code_violation: "false",
        years_owned: yearsSince(parseIntegerDateValue(attributes.DATESOLD)),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Robeson County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DEEDBOOK), normalizeArcGisText(attributes.DEEDPAGE)].filter(Boolean).join("/"),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchRockinghamCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Rockingham"))?.source_url?.split("?")[0]
    || "https://services.gis.nc.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0/query";
  const params = new URLSearchParams({
    where: "cntyname = 'Rockingham' AND saledate IS NOT NULL AND siteadd IS NOT NULL",
    outFields: "ownname,ownname2,mailadd,munit,mcity,mstate,mzip,siteadd,scity,parno,altparno,saledate,saledatetx,sourceref,struct,structno,parusedesc,cntyname,parval,landval",
    returnGeometry: "false",
    orderByFields: "saledate DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Rockingham absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: RockinghamParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.siteadd);
      const ownerName = [normalizeArcGisText(attributes.ownname), normalizeArcGisText(attributes.ownname2)].filter(Boolean).join(" / ");
      const mailingAddress = [
        normalizeArcGisText(attributes.mailadd),
        normalizeArcGisText(attributes.munit),
        normalizeArcGisText(attributes.mcity),
        normalizeArcGisText(attributes.mstate),
        normalizeArcGisText(attributes.mzip),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.parno || attributes.altparno);
      const propertyCity = normalizeArcGisText(attributes.scity) || input.city?.trim() || "Rockingham County";
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.mailadd));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Rockingham",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.mzip),
        property_type: normalizeArcGisText(attributes.parusedesc) || "Property",
        assessed_value: attributes.parval ? String(Math.round(attributes.parval)) : "",
        last_sale_date: normalizeArcGisDate(attributes.saledate),
        last_sale_price: "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.structno || normalizeArcGisText(attributes.struct) === "N" ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.saledate),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Rockingham County Absentee Owners",
        deed_reference: normalizeArcGisText(attributes.sourceref),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchOrangeCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Orange"))?.source_url?.split("?")[0];
  if (!endpoint) throw new Error("Orange County source row is missing a live source_url.");
  const params = new URLSearchParams({
    where: "DATESOLD IS NOT NULL",
    outFields: "PIN,OWNER1,OWNER2,ADDRESS1,ADDRESS2,CITY,STATE,ZIPCODE,LANDVALUE,BLDGVALUE,BLDGCNT,VALUATION,DEEDREF,DATESOLD,DATESOLDTXT,YEARBUILT,SQFT,LEGAL_DESC",
    returnGeometry: "false",
    orderByFields: "DATESOLD DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Orange absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: OrangeParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const ownerName = [normalizeArcGisText(attributes.OWNER1), normalizeArcGisText(attributes.OWNER2)].filter(Boolean).join(" / ");
      const propertyAddress = normalizeArcGisText(attributes.LEGAL_DESC);
      const mailingAddress = [
        normalizeArcGisText(attributes.ADDRESS1),
        normalizeArcGisText(attributes.ADDRESS2),
        normalizeArcGisText(attributes.CITY),
        normalizeArcGisText(attributes.STATE),
        normalizeArcGisText(attributes.ZIPCODE),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN);
      const propertyCity = input.city?.trim() || "Hillsborough";
      const absentee = propertyAddress
        && normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.ADDRESS1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Orange",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.ZIPCODE),
        property_type: normalizeArcGisText(attributes.LEGAL_DESC) || "Property",
        assessed_value: attributes.VALUATION ? String(Math.round(attributes.VALUATION)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DATESOLD),
        last_sale_price: "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.BLDGCNT || !attributes.BLDGVALUE ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DATESOLD),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Orange County Absentee Owners",
        deed_reference: normalizeArcGisText(attributes.DEEDREF),
        year_built: attributes.YEARBUILT ? String(attributes.YEARBUILT) : "",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchNashCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Nash"))?.source_url?.split("?")[0];
  if (!endpoint) throw new Error("Nash County source row is missing a live source_url.");
  const params = new URLSearchParams({
    where: "SALEDATE IS NOT NULL AND PHYS_ADDR IS NOT NULL",
    outFields: "GIS_PARID,GIS_PIN,TAX_PARID,TAX_PIN,OWNER1,OWNER2,CAREOF,MAIL_ADDR1,MAIL_ADDR2,ML_C_ST_Z,PHYS_ADDR,DESCRIPLOC,LANDTYPE,DEEDACRES,GIS_ACRES,DEEDBOOK,DEEDPAGE,SALEDATE,SALECODE,SALEPRICE,PROPTYPE,LANDVALUE,TOT_B_VAL,APR_VAL,ASM_VAL,LEGAL1,LEGAL2,LEGAL3",
    returnGeometry: "false",
    orderByFields: "SALEDATE DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await postArcgisQueryWithTimeout(endpoint, params, 20000) as {
    error?: { message?: string };
    features?: Array<{ attributes?: NashParcelAttributes }>;
  };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.PHYS_ADDR || attributes.DESCRIPLOC);
      const ownerName = [normalizeArcGisText(attributes.OWNER1), normalizeArcGisText(attributes.OWNER2)].filter(Boolean).join(" / ");
      const mailingAddress = [
        normalizeArcGisText(attributes.CAREOF),
        normalizeArcGisText(attributes.MAIL_ADDR1),
        normalizeArcGisText(attributes.MAIL_ADDR2),
        normalizeArcGisText(attributes.ML_C_ST_Z),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.GIS_PIN || attributes.TAX_PIN || attributes.GIS_PARID || attributes.TAX_PARID);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Nash County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.MAIL_ADDR1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Nash",
        city: propertyCity,
        zip_code: normalizeArcGisText(parseCityStateZipTail(normalizeArcGisText(attributes.ML_C_ST_Z)).zip),
        property_type: normalizeArcGisText(attributes.PROPTYPE || attributes.LANDTYPE || attributes.LEGAL1) || "Property",
        assessed_value: attributes.ASM_VAL ? String(Math.round(attributes.ASM_VAL)) : "",
        last_sale_date: normalizeArcGisDate(attributes.SALEDATE),
        last_sale_price: attributes.SALEPRICE ? String(Math.round(attributes.SALEPRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.TOT_B_VAL || /VACANT|LAND/i.test(normalizeArcGisText(attributes.LANDTYPE || "")) ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.SALEDATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Nash County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DEEDBOOK), normalizeArcGisText(attributes.DEEDPAGE)].filter(Boolean).join("/"),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchEdgecombeCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Edgecombe"))?.source_url?.split("?")[0];
  if (!endpoint) throw new Error("Edgecombe County source row is missing a live source_url.");
  const params = new URLSearchParams({
    where: "deeddate IS NOT NULL AND location IS NOT NULL",
    outFields: "parcel,owner,address,city,st,zip,location,propdescr,deeddate,salepr,bk_pg,account,twp,acreage,landval,bldgval,netval,deferred,subdivisio,pclass,pin,pinsuf,altpin,linkpin,deeddatestr",
    returnGeometry: "false",
    orderByFields: "deeddate DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Edgecombe absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: EdgecombeParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.location);
      const ownerName = normalizeArcGisText(attributes.owner);
      const mailingAddress = [
        normalizeArcGisText(attributes.address),
        normalizeArcGisText(attributes.city),
        normalizeArcGisText(attributes.st),
        normalizeArcGisText(attributes.zip),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.pin || attributes.parcel || attributes.altpin);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Edgecombe County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.address));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Edgecombe",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.zip),
        property_type: normalizeArcGisText(attributes.pclass || attributes.propdescr) || "Property",
        assessed_value: attributes.netval ? String(Math.round(attributes.netval)) : "",
        last_sale_date: normalizeArcGisDate(attributes.deeddate),
        last_sale_price: attributes.salepr ? String(Math.round(attributes.salepr)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.bldgval ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.deeddate),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Edgecombe County Absentee Owners",
        deed_reference: normalizeArcGisText(attributes.bk_pg),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchAsheCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Ashe"))?.source_url?.split("?")[0];
  if (!endpoint) throw new Error("Ashe County source row is missing a live source_url.");
  const params = new URLSearchParams({
    where: "DeedDate IS NOT NULL",
    outFields: "ParcelNumb,GPIN,Name1,Address1,Address2,Address3,City,State,ZipCode,LegalLandU,LegalLandT,DeedDate,DeedBook,DeedPage,SalePrice,SaleYear,ParcelProp,LegalDescr,ParcelLand,ParcelBuil,ParcelObxf,TotalMarke,TotalAsses,OwnershipT",
    returnGeometry: "false",
    orderByFields: "DeedDate DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Ashe absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: AsheParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.ParcelProp || attributes.LegalDescr);
      const ownerName = normalizeArcGisText(attributes.Name1);
      const mailingAddress = [
        normalizeArcGisText(attributes.Address1),
        normalizeArcGisText(attributes.Address2),
        normalizeArcGisText(attributes.Address3),
        normalizeArcGisText(attributes.City),
        normalizeArcGisText(attributes.State),
        normalizeArcGisText(attributes.ZipCode),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.GPIN || attributes.ParcelNumb);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Ashe County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.Address1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Ashe",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.ZipCode),
        property_type: normalizeArcGisText(attributes.LegalLandU || attributes.LegalLandT || attributes.OwnershipT) || "Property",
        assessed_value: attributes.TotalAsses ? String(Math.round(attributes.TotalAsses)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DeedDate),
        last_sale_price: attributes.SalePrice ? String(Math.round(attributes.SalePrice)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.ParcelBuil ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DeedDate),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Ashe County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DeedBook), normalizeArcGisText(attributes.DeedPage)].filter(Boolean).join("/"),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchAveryCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Avery"))?.source_url?.split("?")[0];
  if (!endpoint) throw new Error("Avery County source row is missing a live source_url.");
  const params = new URLSearchParams({
    where: "DEED_DATE IS NOT NULL AND ADDRESS IS NOT NULL",
    outFields: "PIN,OWNER_NAME,NAME_1,ADDR_1,ADDR_2,ADDR_3,CITY,STATE,ZIP,ADDRESS,DEED_DATE,DEEDBOOK,DEEDPAGE,SALEPRICE,LAND_VALU,BUILD_VALU,TOTAL_VALU,AYB,ACREAGE,LEGAL_1,LEGAL_2,PARNUM,ACCT_NO,TAX_YEAR",
    returnGeometry: "false",
    orderByFields: "DEED_DATE DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Avery absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: AveryParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.ADDRESS);
      const ownerName = normalizeArcGisText(attributes.OWNER_NAME || attributes.NAME_1);
      const mailingAddress = [
        normalizeArcGisText(attributes.ADDR_1),
        normalizeArcGisText(attributes.ADDR_2),
        normalizeArcGisText(attributes.ADDR_3),
        normalizeArcGisText(attributes.CITY),
        normalizeArcGisText(attributes.STATE),
        normalizeArcGisText(attributes.ZIP),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN || attributes.PARNUM || attributes.ACCT_NO);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Avery County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.ADDR_1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Avery",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.ZIP),
        property_type: normalizeArcGisText(attributes.LEGAL_1 || attributes.LEGAL_2) || "Property",
        assessed_value: attributes.TOTAL_VALU ? String(Math.round(attributes.TOTAL_VALU)) : "",
        last_sale_date: normalizeArcGisDate(attributes.DEED_DATE),
        last_sale_price: attributes.SALEPRICE ? String(Math.round(attributes.SALEPRICE)) : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.BUILD_VALU ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.DEED_DATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Avery County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DEEDBOOK), normalizeArcGisText(attributes.DEEDPAGE)].filter(Boolean).join("/"),
        year_built: attributes.AYB ? String(attributes.AYB) : "",
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchBurkeCountyAbsenteeRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const endpoint = (await getBuyerCountyRegistrySource("Burke"))?.source_url?.split("?")[0];
  if (!endpoint) throw new Error("Burke County source row is missing a live source_url.");
  const params = new URLSearchParams({
    where: "PKG_SALE_DATE IS NOT NULL AND LOCATION_ADDR IS NOT NULL",
    outFields: "PARCEL_PK,PIN,PIN_EXT,LOCATION_ADDR,LAND_CLASS,DEEDED_ACRES,PROPERTY_OWNER,OWNER_MAIL_1,OWNER_MAIL_2,OWNER_MAIL_3,OWNER_MAIL_CITY,OWNER_MAIL_STATE,OWNER_MAIL_ZIP,TOTAL_LAND_VALUE_ASSESSED,TOTAL_BLDG_VALUE_ASSESSED,LAND_USE_VALUE,DEED_DATE,DEED_BOOK,DEED_PAGE,PKG_SALE_DATE,PKG_SALE_PRICE,LAND_SALE_DATE,LAND_SALE_PRICE",
    returnGeometry: "false",
    orderByFields: "PKG_SALE_DATE DESC",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });
  const payload = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Burke absentee fetch failed with status ${response.status}.`);
      return response.json();
    }) as { error?: { message?: string }; features?: Array<{ attributes?: BurkeParcelAttributes }> };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const propertyAddress = normalizeArcGisText(attributes.LOCATION_ADDR);
      const ownerName = normalizeArcGisText(attributes.PROPERTY_OWNER);
      const mailingAddress = [
        normalizeArcGisText(attributes.OWNER_MAIL_1),
        normalizeArcGisText(attributes.OWNER_MAIL_2),
        normalizeArcGisText(attributes.OWNER_MAIL_3),
        normalizeArcGisText(attributes.OWNER_MAIL_CITY),
        normalizeArcGisText(attributes.OWNER_MAIL_STATE),
        normalizeArcGisText(attributes.OWNER_MAIL_ZIP),
      ].filter(Boolean).join(", ");
      const parcelId = normalizeArcGisText(attributes.PIN || attributes.PIN_EXT || attributes.PARCEL_PK);
      const propertyCity = input.city?.trim() || inferCityFromPropertyAddress(propertyAddress, "Burke County");
      const absentee = normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(normalizeArcGisText(attributes.OWNER_MAIL_1));
      if (!propertyAddress || !ownerName || !mailingAddress || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: "Burke",
        city: propertyCity,
        zip_code: normalizeArcGisText(attributes.OWNER_MAIL_ZIP),
        property_type: normalizeArcGisText(attributes.LAND_CLASS) || "Property",
        assessed_value: attributes.TOTAL_LAND_VALUE_ASSESSED || attributes.TOTAL_BLDG_VALUE_ASSESSED
          ? String(Math.round((attributes.TOTAL_LAND_VALUE_ASSESSED ?? 0) + (attributes.TOTAL_BLDG_VALUE_ASSESSED ?? 0)))
          : "",
        last_sale_date: normalizeArcGisDate(attributes.PKG_SALE_DATE || attributes.DEED_DATE || attributes.LAND_SALE_DATE),
        last_sale_price: attributes.PKG_SALE_PRICE || attributes.LAND_SALE_PRICE
          ? String(Math.round(attributes.PKG_SALE_PRICE ?? attributes.LAND_SALE_PRICE ?? 0))
          : "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !attributes.TOTAL_BLDG_VALUE_ASSESSED ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(attributes.PKG_SALE_DATE || attributes.DEED_DATE || attributes.LAND_SALE_DATE),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: "Burke County Absentee Owners",
        deed_reference: [normalizeArcGisText(attributes.DEED_BOOK), normalizeArcGisText(attributes.DEED_PAGE)].filter(Boolean).join("/"),
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return rankSellerRows(rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" }))).slice(0, requestedLimit);
}

async function fetchGenericNcCountyAbsenteeRows(
  input: LiveSellerSearchInput,
  countyName: string,
  defaultCity: string,
  sourceName: string,
): Promise<SellerImportRow[]> {
  const requestedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const registrySource = await getBuyerCountyRegistrySource(countyName);

  if (!registrySource?.source_url) {
    return fetchNcOneMapAbsenteeRows({ ...input, county: countyName });
  }

  const endpoint = registrySource.source_url.split("?")[0];
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    returnGeometry: "false",
    resultRecordCount: String(Math.min(Math.max(requestedLimit * 4, 100), 500)),
    f: "json",
  });

  const payload = await postArcgisQueryWithTimeout(endpoint, params, 25000) as {
    error?: { message?: string };
    features?: Array<{ attributes?: GenericNcParcelAttributes }>;
  };
  if (payload.error?.message) throw new Error(payload.error.message);

  const cityFilter = input.city?.trim().toUpperCase();

  const rows = (payload.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .flatMap((attributes) => {
      const parcelId = normalizeArcGisText(
        attributes.PIN_NUM || attributes.PIN || attributes.PARCEL_ID || attributes.PARCEL_NUMBER
          || attributes.GIS_PARID || attributes.TAX_PARID || attributes.REID
          || attributes.PARCEL_PK || attributes.GPIN || attributes.GPINLONG || attributes.parno,
      );
      const ownerName = [
        normalizeArcGisText(
          attributes.OWNER || attributes.OWNER1 || attributes.PROPERTY_OWNER
            || attributes.OWNNAME || attributes.NAME1 || attributes.ownname,
        ),
        normalizeArcGisText(attributes.OWNER2 || attributes.NAME2 || attributes.ownlast),
      ].filter(Boolean).join(" / ");
      const mailLine1 = normalizeArcGisText(
        attributes.ADDR1 || attributes.MAIL_ADDR1 || attributes.OWNER_MAIL_1
          || attributes.ADDRESS1 || attributes.TaxPayerAddr1 || attributes.MAILADD || attributes.mailadd,
      );
      const mailLine2 = normalizeArcGisText(
        attributes.ADDR2 || attributes.MAIL_ADDR2 || attributes.OWNER_MAIL_2
          || attributes.ADDRESS2 || attributes.TaxPayerAddr2,
      );
      const mailLine3 = normalizeArcGisText(attributes.OWNER_MAIL_3);
      const mailCity = normalizeArcGisText(
        attributes.CITY || attributes.MAIL_CITY || attributes.OWNER_MAIL_CITY || attributes.TaxPayerCity || attributes.mcity,
      );
      const mailState = normalizeArcGisText(
        attributes.STATE || attributes.MAIL_STATE || attributes.OWNER_MAIL_STATE || attributes.mstate,
      );
      const mailZip = normalizeArcGisText(
        attributes.ZIP || attributes.ZIPCODE || attributes.MAIL_ZIP || attributes.OWNER_MAIL_ZIP || attributes.Zip || attributes.mzip,
      );
      const propertyAddress = normalizeArcGisText(
        attributes.SITE_ADDRESS || attributes.PROP_ADDR || attributes.LOCATION_ADDR
          || attributes.PHYSICAL_ADDRESS || attributes.PHYS_ADDR || attributes.PARCEL_ADD
          || attributes.PhyStreetAddr || attributes.FormattedPropertyAddress || attributes.siteadd,
      );
      const propertyCity = input.city?.trim()
        || normalizeArcGisText(attributes.CITY_DECODE || attributes.PHYS_ADDR_CITY || attributes.scity)
        || inferCityFromPropertyAddress(propertyAddress, defaultCity);
      const saleDate = attributes.DEED_DATE || attributes.DEEDDATE || attributes.SALEDATE
        || attributes.SALE_DATE || attributes.PKG_SALE_DATE || attributes.date_dt
        || (typeof attributes.DATESOLD === "number" ? attributes.DATESOLD : undefined)
        || attributes.DateSold || attributes.DeedDate || attributes.saledate;
      const assessedValue = attributes.TOTAL_VALUE_ASSD || attributes.TOT_VAL || attributes.ASM_VAL
        || attributes.APR_VAL || attributes.ASSESSED_V || attributes.VALUATION || attributes.parval
        || attributes.TotalASVCurrent || attributes.TotalAsses || attributes.AssessedValue
        || ((attributes.TOTAL_LAND_VALUE_ASSESSED || 0) + (attributes.TOTAL_BLDG_VALUE_ASSESSED || 0)) || 0;
      const hasBuildingValue = Boolean(
        attributes.BLDG_VAL || attributes.BLDGVALUE || attributes.TOT_B_VAL
          || attributes.TOTAL_BLDG_VALUE_ASSESSED || attributes.NBR_BLDG || attributes.BLDGCNT,
      );
      const propertyType = normalizeArcGisText(
        attributes.LAND_USE || attributes.LANDTYPE || attributes.LAND_CLASS || attributes.TYPE_USE_DECODE
          || attributes.LAND_CLASS_DECODE || attributes.parusedesc || attributes.parusedsc2
          || attributes.PROPTYPE || attributes.PARCEL_CLA || attributes.LegalLandT,
      );
      const mailingAddress = [mailLine1, mailLine2, mailLine3, mailCity, mailState, mailZip].filter(Boolean).join(", ");
      const absentee = propertyAddress
        && normalizeAddressForComparison(propertyAddress) !== normalizeAddressForComparison(mailLine1);

      if (!propertyAddress || !ownerName || !parcelId || !absentee) return [];

      return [{
        property_address: propertyAddress,
        parcel_id: parcelId,
        county: countyName,
        city: propertyCity,
        zip_code: mailZip,
        property_type: propertyType || "Property",
        assessed_value: assessedValue ? String(Math.round(assessedValue)) : "",
        last_sale_date: normalizeArcGisDate(saleDate),
        last_sale_price: "",
        owner_name: ownerName,
        owner_mailing_address: mailingAddress,
        owner_occupancy_status: isCorporateOwnerName(ownerName) ? "Absentee / Corporate" : "Absentee",
        tax_delinquent: "false",
        foreclosure: "false",
        probate: "false",
        vacant: !hasBuildingValue ? "true" : "false",
        code_violation: "false",
        years_owned: yearsSince(saleDate),
        estimated_equity: "",
        multiple_properties: "false",
        source_name: sourceName,
      } satisfies SellerImportRow];
    })
    .filter((row) => !cityFilter || row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter));

  const ownerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.owner_name.trim().toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return rankSellerRows(
    rows.map((row) => ({ ...row, multiple_properties: (ownerCounts[row.owner_name.trim().toUpperCase()] ?? 0) > 1 ? "true" : "false" })),
  ).slice(0, requestedLimit);
}

// ── Triangle / Piedmont ──────────────────────────────────────────────────────
async function fetchDurhamCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Durham", "Durham", "Durham County Absentee Owners");
}
async function fetchChathamCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Chatham", "Pittsboro", "Chatham County Absentee Owners");
}
async function fetchJohnstonCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Johnston", "Smithfield", "Johnston County Absentee Owners");
}
async function fetchHarnettCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Harnett", "Lillington", "Harnett County Absentee Owners");
}
// ── Charlotte metro ───────────────────────────────────────────────────────────
async function fetchCabarrusCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Cabarrus", "Concord", "Cabarrus County Absentee Owners");
}
async function fetchUnionCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Union", "Monroe", "Union County Absentee Owners");
}
async function fetchIredellCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Iredell", "Statesville", "Iredell County Absentee Owners");
}
async function fetchGastonCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Gaston", "Gastonia", "Gaston County Absentee Owners");
}
async function fetchLincolnCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Lincoln", "Lincolnton", "Lincoln County Absentee Owners");
}
// ── Piedmont Triad ────────────────────────────────────────────────────────────
async function fetchRowanCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Rowan", "Salisbury", "Rowan County Absentee Owners");
}
async function fetchDavidsonCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Davidson", "Lexington", "Davidson County Absentee Owners");
}
async function fetchAlamanceCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Alamance", "Graham", "Alamance County Absentee Owners");
}
async function fetchRandolphCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Randolph", "Asheboro", "Randolph County Absentee Owners");
}
async function fetchCatawbaCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Catawba", "Newton", "Catawba County Absentee Owners");
}
// ── Western NC / Mountains ────────────────────────────────────────────────────
async function fetchBuncombeCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Buncombe", "Asheville", "Buncombe County Absentee Owners");
}
async function fetchHendersonCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Henderson", "Hendersonville", "Henderson County Absentee Owners");
}
async function fetchWataugaCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Watauga", "Boone", "Watauga County Absentee Owners");
}
async function fetchSurryCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Surry", "Dobson", "Surry County Absentee Owners");
}
async function fetchCaldwellCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Caldwell", "Lenoir", "Caldwell County Absentee Owners");
}
// ── Coastal / Cape Fear ───────────────────────────────────────────────────────
async function fetchNewHanoverCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "New Hanover", "Wilmington", "New Hanover County Absentee Owners");
}
async function fetchBrunswickCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Brunswick", "Bolivia", "Brunswick County Absentee Owners");
}
async function fetchPenderCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Pender", "Burgaw", "Pender County Absentee Owners");
}
async function fetchOnslowCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Onslow", "Jacksonville", "Onslow County Absentee Owners");
}
async function fetchCravenCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Craven", "New Bern", "Craven County Absentee Owners");
}
// ── Eastern NC ────────────────────────────────────────────────────────────────
async function fetchPittCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Pitt", "Greenville", "Pitt County Absentee Owners");
}
async function fetchWayneCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Wayne", "Goldsboro", "Wayne County Absentee Owners");
}
async function fetchWilsonCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Wilson", "Wilson", "Wilson County Absentee Owners");
}
async function fetchVanceCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Vance", "Henderson", "Vance County Absentee Owners");
}
async function fetchMooreCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Moore", "Carthage", "Moore County Absentee Owners");
}
async function fetchLeeCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Lee", "Sanford", "Lee County Absentee Owners");
}
async function fetchDuplinCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Duplin", "Kenansville", "Duplin County Absentee Owners");
}
async function fetchHalifaxCountyAbsenteeRows(input: LiveSellerSearchInput) {
  return fetchGenericNcCountyAbsenteeRows(input, "Halifax", "Halifax", "Halifax County Absentee Owners");
}

async function fetchMecklenburgDelinquentRows(input: LiveSellerSearchInput): Promise<SellerImportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const [individualRows, businessRows] = await Promise.all([
    downloadMecklenburgXlsxRows("https://mecknc.widen.net/content/kt1lahiyth/original/IND_Taxbills_Advertisement.xlsx?u=6mkblw&download=true"),
    downloadMecklenburgXlsxRows("https://mecknc.widen.net/content/xjmul0wxtk/original/BUSOTH_Taxbills_Advertisement.xlsx?u=6mkblw&download=true"),
  ]);

  const cityFilter = input.city?.trim().toUpperCase();
  const rows = [...individualRows, ...businessRows]
    .flatMap((row) => {
      const ownerName = (row[0] ?? "").trim();
      const address = (row[1] ?? "").replace(/\s+/g, " ").trim();
      const amount = (row[3] ?? "").replace(/[^0-9.]/g, "");
      const location = parseCityStateZipTail(address);
      const city = input.city?.trim() || location.city || "Charlotte";
      if (!ownerName || !address) return [];

      return [{
        property_address: address,
        parcel_id: `MECK-DELINQ-${stableSyntheticParcelId([ownerName, address, amount])}`,
        county: "Mecklenburg",
        city,
        zip_code: location.zip,
        property_type: "Tax Delinquent",
        assessed_value: "",
        last_sale_date: "",
        last_sale_price: "",
        owner_name: ownerName,
        owner_mailing_address: "",
        owner_occupancy_status: "Unknown",
        tax_delinquent: "true",
        foreclosure: "false",
        probate: "false",
        vacant: "false",
        code_violation: "false",
        years_owned: "",
        estimated_equity: "",
        source_name: "Mecklenburg County Delinquent Taxpayers",
        delinquent_amount: amount,
      } satisfies SellerImportRow];
    })
    .filter((row) => {
      if (!cityFilter) return true;
      return row.city.toUpperCase().includes(cityFilter) || row.property_address.toUpperCase().includes(cityFilter);
    });

  return rows.slice(0, limit);
}

export async function runSellerLiveSearch(input: LiveSellerSearchInput) {
  const sourceKey = input.sourceKey ?? SELLER_LIVE_SOURCE_KEY;
  const county = input.county.trim();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  if (!county) throw new Error("County is required for a live seller search.");
  const source = SELLER_LIVE_SOURCES.find((item) => item.key === sourceKey);
  if (!source) throw new Error("Unsupported live seller source.");

  const city = input.city?.trim() || undefined;
  const rows = sourceKey === "nc_onemap_full_recon_sweep"
    ? mergeSellerRowsByParcel(
        rankSellerRows(
          (
            await Promise.all([
              fetchNcOneMapAbsenteeRows({ sourceKey: "nc_onemap_motivated_seller_sweep", county, city, limit }),
              fetchNcOneMapAbsenteeRows({ sourceKey: "nc_onemap_high_value_absentee_search", county, city, limit }),
              fetchNcOneMapAbsenteeRows({ sourceKey: "nc_onemap_portfolio_absentee_search", county, city, limit }),
              fetchNcOneMapAbsenteeRows({ sourceKey: "nc_onemap_corporate_absentee_search", county, city, limit }),
            ])
          ).flat(),
        ),
      ).slice(0, limit)
    : sourceKey === "cumberland_county_foreclosure_sales"
      ? await fetchCumberlandForeclosureRows({ sourceKey, county, city, limit })
    : sourceKey === "cumberland_county_delinquent_taxes"
      ? await fetchCumberlandDelinquentTaxRows({ sourceKey, county, city, limit })
    : sourceKey === "forsyth_county_foreclosure_sales"
      ? await fetchForsythForeclosureRows({ sourceKey, county, city, limit })
    : sourceKey === "guilford_county_foreclosure_research"
      ? await fetchGuilfordForeclosureRows({ sourceKey, county, city, limit })
    : sourceKey === "mecklenburg_county_foreclosure_properties"
      ? await fetchMecklenburgForeclosureRows({ sourceKey, county, city, limit })
    : sourceKey === "mecklenburg_county_delinquent_taxpayers"
      ? await fetchMecklenburgDelinquentRows({ sourceKey, county, city, limit })
    : sourceKey === "wake_county_absentee_owners"
      ? await fetchWakeCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "beaufort_county_absentee_owners"
      ? await fetchBeaufortCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "granville_county_absentee_owners"
      ? await fetchGranvilleCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "sampson_county_absentee_owners"
      ? await fetchSampsonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "stokes_county_absentee_owners"
      ? await fetchStokesCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "stanly_county_absentee_owners"
      ? await fetchStanlyCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "wilkes_county_absentee_owners"
      ? await fetchWilkesCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "warren_county_absentee_owners"
      ? await fetchWarrenCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "robeson_county_absentee_owners"
      ? await fetchRobesonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "rockingham_county_absentee_owners"
      ? await fetchRockinghamCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "orange_county_absentee_owners"
      ? await fetchOrangeCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "nash_county_absentee_owners"
      ? await fetchNashCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "edgecombe_county_absentee_owners"
      ? await fetchEdgecombeCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "ashe_county_absentee_owners"
      ? await fetchAsheCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "avery_county_absentee_owners"
      ? await fetchAveryCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "burke_county_absentee_owners"
      ? await fetchBurkeCountyAbsenteeRows({ sourceKey, county, city, limit })
    // ── Triangle / Piedmont ──────────────────────────────────────────────
    : sourceKey === "durham_county_absentee_owners"
      ? await fetchDurhamCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "chatham_county_absentee_owners"
      ? await fetchChathamCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "johnston_county_absentee_owners"
      ? await fetchJohnstonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "harnett_county_absentee_owners"
      ? await fetchHarnettCountyAbsenteeRows({ sourceKey, county, city, limit })
    // ── Charlotte metro ──────────────────────────────────────────────────
    : sourceKey === "cabarrus_county_absentee_owners"
      ? await fetchCabarrusCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "union_county_absentee_owners"
      ? await fetchUnionCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "iredell_county_absentee_owners"
      ? await fetchIredellCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "gaston_county_absentee_owners"
      ? await fetchGastonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "lincoln_county_absentee_owners"
      ? await fetchLincolnCountyAbsenteeRows({ sourceKey, county, city, limit })
    // ── Piedmont Triad ───────────────────────────────────────────────────
    : sourceKey === "rowan_county_absentee_owners"
      ? await fetchRowanCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "davidson_county_absentee_owners"
      ? await fetchDavidsonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "alamance_county_absentee_owners"
      ? await fetchAlamanceCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "randolph_county_absentee_owners"
      ? await fetchRandolphCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "catawba_county_absentee_owners"
      ? await fetchCatawbaCountyAbsenteeRows({ sourceKey, county, city, limit })
    // ── Western NC / Mountains ───────────────────────────────────────────
    : sourceKey === "buncombe_county_absentee_owners"
      ? await fetchBuncombeCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "henderson_county_absentee_owners"
      ? await fetchHendersonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "watauga_county_absentee_owners"
      ? await fetchWataugaCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "surry_county_absentee_owners"
      ? await fetchSurryCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "caldwell_county_absentee_owners"
      ? await fetchCaldwellCountyAbsenteeRows({ sourceKey, county, city, limit })
    // ── Coastal / Cape Fear ──────────────────────────────────────────────
    : sourceKey === "new_hanover_county_absentee_owners"
      ? await fetchNewHanoverCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "brunswick_county_absentee_owners"
      ? await fetchBrunswickCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "pender_county_absentee_owners"
      ? await fetchPenderCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "onslow_county_absentee_owners"
      ? await fetchOnslowCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "craven_county_absentee_owners"
      ? await fetchCravenCountyAbsenteeRows({ sourceKey, county, city, limit })
    // ── Eastern NC ──────────────────────────────────────────────────────
    : sourceKey === "pitt_county_absentee_owners"
      ? await fetchPittCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "wayne_county_absentee_owners"
      ? await fetchWayneCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "wilson_county_absentee_owners"
      ? await fetchWilsonCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "vance_county_absentee_owners"
      ? await fetchVanceCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "moore_county_absentee_owners"
      ? await fetchMooreCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "lee_county_absentee_owners"
      ? await fetchLeeCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "duplin_county_absentee_owners"
      ? await fetchDuplinCountyAbsenteeRows({ sourceKey, county, city, limit })
    : sourceKey === "halifax_county_absentee_owners"
      ? await fetchHalifaxCountyAbsenteeRows({ sourceKey, county, city, limit })
    : await fetchNcOneMapAbsenteeRows({
        sourceKey,
        county,
        city,
        limit,
      });
  if (!rows.length) {
    return { imported: 0, total: 0, errors: [], sourceName: source.label, sourceDescription: source.description, sourceKey };
  }

  const sourceUrl =
    sourceKey === "cumberland_county_foreclosure_sales"
      ? "https://www.cumberlandcountync.gov/departments/tax-group/tax/tax-foreclosure-sales"
      : sourceKey === "cumberland_county_delinquent_taxes"
        ? "https://www.cumberlandcountync.gov/CustomContent/tax/delinquent_taxes/delinquent_taxes.aspx?TaxDelinquent_GVChangePage=91_20"
        : sourceKey === "forsyth_county_foreclosure_sales"
          ? "https://co.forsyth.nc.us/tax/foreclosure_prop.aspx"
          : sourceKey === "guilford_county_foreclosure_research"
            ? "https://gcgis.guilfordcountync.gov/arcgis/rest/services/Foreclosure/ForeclosuresPublic/FeatureServer/0"
            : sourceKey === "mecklenburg_county_foreclosure_properties"
              ? "https://tax.mecknc.gov/services/tax-foreclosure-properties"
            : sourceKey === "mecklenburg_county_delinquent_taxpayers"
              ? "https://tax.mecknc.gov/services/Delinquent-Taxpayer-Lists"
            : sourceKey === "wake_county_absentee_owners"
              ? "https://maps.wake.gov/arcgis/rest/services/Property/Parcels/MapServer/0"
            : sourceKey === "beaufort_county_absentee_owners"
              ? "https://services1.arcgis.com/oXsk9nimtmSEU8Ko/arcgis/rest/services/Beaufort_Service/FeatureServer/4"
            : sourceKey === "granville_county_absentee_owners"
              ? "https://services8.arcgis.com/dT3Tew5pivPd2bWH/arcgis/rest/services/Granville_Service/FeatureServer/8"
            : sourceKey === "sampson_county_absentee_owners"
              ? "https://services3.arcgis.com/fM4kjZmPOS4ay2Ff/arcgis/rest/services/Parcels/FeatureServer/0"
            : sourceKey === "stokes_county_absentee_owners"
              ? "https://stokescountygis.com/server/rest/services/ParcelsNew/MapServer/2"
            : sourceKey === "stanly_county_absentee_owners"
              ? "https://services6.arcgis.com/w1igg0Q14weqYXUh/arcgis/rest/services/parcel_records_base_2/FeatureServer/3"
            : sourceKey === "wilkes_county_absentee_owners"
              ? "https://gis.wilkescounty.net/arcgis/rest/services/Parcels_Data/MapServer/0"
            : sourceKey === "warren_county_absentee_owners"
              ? "https://arcgis4.roktech.net/arcgis/rest/services/Warren/RokMap/MapServer/4"
            : sourceKey === "robeson_county_absentee_owners"
              ? "https://arcgis4.roktech.net/arcgis/rest/services/robeson/ROKMAPS_v2/MapServer/15"
            : sourceKey === "rockingham_county_absentee_owners"
              ? "https://services.gis.nc.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0"
            : sourceKey === "orange_county_absentee_owners"
              ? "buyer_registry:Orange"
            : sourceKey === "nash_county_absentee_owners"
              ? "buyer_registry:Nash"
            : sourceKey === "edgecombe_county_absentee_owners"
              ? "buyer_registry:Edgecombe"
            : sourceKey === "ashe_county_absentee_owners"
              ? "buyer_registry:Ashe"
            : sourceKey === "avery_county_absentee_owners"
              ? "buyer_registry:Avery"
            : sourceKey === "burke_county_absentee_owners"
              ? "buyer_registry:Burke"
            : sourceKey === "durham_county_absentee_owners"
              ? "buyer_registry:Durham"
            : sourceKey === "chatham_county_absentee_owners"
              ? "buyer_registry:Chatham"
            : sourceKey === "johnston_county_absentee_owners"
              ? "buyer_registry:Johnston"
            : sourceKey === "harnett_county_absentee_owners"
              ? "buyer_registry:Harnett"
            : sourceKey === "cabarrus_county_absentee_owners"
              ? "buyer_registry:Cabarrus"
            : sourceKey === "union_county_absentee_owners"
              ? "buyer_registry:Union"
            : sourceKey === "iredell_county_absentee_owners"
              ? "buyer_registry:Iredell"
            : sourceKey === "gaston_county_absentee_owners"
              ? "buyer_registry:Gaston"
            : sourceKey === "lincoln_county_absentee_owners"
              ? "buyer_registry:Lincoln"
            : sourceKey === "rowan_county_absentee_owners"
              ? "buyer_registry:Rowan"
            : sourceKey === "davidson_county_absentee_owners"
              ? "buyer_registry:Davidson"
            : sourceKey === "alamance_county_absentee_owners"
              ? "buyer_registry:Alamance"
            : sourceKey === "randolph_county_absentee_owners"
              ? "buyer_registry:Randolph"
            : sourceKey === "catawba_county_absentee_owners"
              ? "buyer_registry:Catawba"
            : sourceKey === "buncombe_county_absentee_owners"
              ? "buyer_registry:Buncombe"
            : sourceKey === "henderson_county_absentee_owners"
              ? "buyer_registry:Henderson"
            : sourceKey === "watauga_county_absentee_owners"
              ? "buyer_registry:Watauga"
            : sourceKey === "surry_county_absentee_owners"
              ? "buyer_registry:Surry"
            : sourceKey === "caldwell_county_absentee_owners"
              ? "buyer_registry:Caldwell"
            : sourceKey === "new_hanover_county_absentee_owners"
              ? "buyer_registry:New Hanover"
            : sourceKey === "brunswick_county_absentee_owners"
              ? "buyer_registry:Brunswick"
            : sourceKey === "pender_county_absentee_owners"
              ? "buyer_registry:Pender"
            : sourceKey === "onslow_county_absentee_owners"
              ? "buyer_registry:Onslow"
            : sourceKey === "craven_county_absentee_owners"
              ? "buyer_registry:Craven"
            : sourceKey === "pitt_county_absentee_owners"
              ? "buyer_registry:Pitt"
            : sourceKey === "wayne_county_absentee_owners"
              ? "buyer_registry:Wayne"
            : sourceKey === "wilson_county_absentee_owners"
              ? "buyer_registry:Wilson"
            : sourceKey === "vance_county_absentee_owners"
              ? "buyer_registry:Vance"
            : sourceKey === "moore_county_absentee_owners"
              ? "buyer_registry:Moore"
            : sourceKey === "lee_county_absentee_owners"
              ? "buyer_registry:Lee"
            : sourceKey === "duplin_county_absentee_owners"
              ? "buyer_registry:Duplin"
            : sourceKey === "halifax_county_absentee_owners"
              ? "buyer_registry:Halifax"
        : "https://services.arcgis.com/04HiymDgLlsbhaV4/arcgis/rest/services/NCOneMap_Parcels/FeatureServer/79";
  const result = await importSellerRows({
    rows,
    sourceName: source.label,
    sourceType: source.sourceType satisfies SellerSourceType,
    county,
    integrationType: "live_api",
    sourceUrl,
    configuration: {
      liveSourceKey: sourceKey,
      city: city ?? null,
      limit,
    },
  });

  return { ...result, sourceName: source.label, sourceDescription: source.description, sourceKey };
}

export async function generateSellerLeadSummary(lead: SellerLeadView) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return `${lead.ownerName} appears to be a ${lead.category.toLowerCase()} because ${lead.reasons.join(", ").toLowerCase()}. ${lead.recommendedAction}`;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are a real-estate seller intelligence analyst. Write a concise, factual motivation summary using only supplied public-record signals. Do not claim certainty, give legal advice, or recommend automated contact.",
        },
        {
          role: "user",
          content: JSON.stringify({
            owner: lead.ownerName,
            property: lead.propertyAddress,
            mailingAddress: lead.ownerMailingAddress,
            score: lead.score,
            reasons: lead.reasons,
            yearsOwned: lead.yearsOwned,
            assessedValue: lead.assessedValue,
            estimatedEquity: lead.estimatedEquity,
          }),
        },
      ],
      max_output_tokens: 220,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI summary request failed with status ${response.status}.`);
  const payload = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const summary = (
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")
      ?.text
  )?.trim();
  if (!summary) throw new Error("OpenAI did not return a seller summary.");

  const supabase = getSupabaseAdmin();
  if (supabase && !lead.id.startsWith("demo-")) {
    await supabase.from("seller_leads").update({ ai_summary: summary, updated_at: new Date().toISOString() }).eq("id", lead.id);
  }
  return summary;
}

export async function listSellerAlerts() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return DEMO_SELLER_LEADS.slice(0, 3).map((lead) => ({
      id: `alert-${lead.id}`,
      title: `${lead.category}: ${lead.ownerName}`,
      message: `${lead.propertyAddress} scored ${lead.score}. ${lead.recommendedAction}`,
      alert_type: lead.score >= 80 ? "new_hot_lead" : "distress_signal",
      read: false,
      created_at: lead.importedAt,
    }));
  }
  const { data, error } = await supabase.from("seller_alerts").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) {
    return DEMO_SELLER_LEADS.slice(0, 3).map((lead) => ({
      id: `alert-${lead.id}`,
      title: `${lead.category}: ${lead.ownerName}`,
      message: `${lead.propertyAddress} scored ${lead.score}. ${lead.recommendedAction}`,
      alert_type: lead.score >= 80 ? "new_hot_lead" : "distress_signal",
      read: false,
      created_at: lead.importedAt,
    }));
  }
  if (!data?.length) return [];
  return data;
}
