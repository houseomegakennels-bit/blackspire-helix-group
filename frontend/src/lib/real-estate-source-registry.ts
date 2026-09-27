import type { RealEstateExpansionState } from "@/lib/real-estate-jurisdiction";
import type { JurisdictionType } from "@/lib/real-estate-market-registry";

export type RealEstateSourceStatus =
  | "discovered"
  | "access_review"
  | "schema_verified"
  | "pilot_verified"
  | "active"
  | "degraded"
  | "blocked";

export type RealEstateSourceTransport = "web_portal" | "download" | "arcgis_rest" | "manual_review";

export type RealEstateSourceCandidate = {
  id: string;
  name: string;
  state: RealEstateExpansionState;
  jurisdictionName: string;
  jurisdictionType: JurisdictionType;
  authoritativeUrl: string;
  intendedUse: "parcel_assessment" | "transfer_verification" | "parcel_identity" | "sales_history";
  transport: RealEstateSourceTransport;
  status: RealEstateSourceStatus;
  adapterVersion: string | null;
  productionEnabled: boolean;
  notes: string;
};

export const REAL_ESTATE_SOURCE_CANDIDATES: RealEstateSourceCandidate[] = [
  {
    id: "tn-comptroller-tpad",
    name: "Tennessee Comptroller TPAD",
    state: "TN",
    jurisdictionName: "Statewide supported counties",
    jurisdictionType: "county",
    authoritativeUrl: "https://assessment.cot.tn.gov/TPAD",
    intendedUse: "parcel_assessment",
    transport: "web_portal",
    status: "access_review",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Research candidate only. Confirm pilot fields, date semantics, terms, completeness, and deed reconciliation before activation.",
  },
  {
    id: "tn-comptroller-parcel-downloads",
    name: "Tennessee Comptroller Parcel Data",
    state: "TN",
    jurisdictionName: "Sullivan",
    jurisdictionType: "county",
    authoritativeUrl: "https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html",
    intendedUse: "parcel_assessment",
    transport: "download",
    status: "access_review",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Preferred first Sullivan pilot path. Verify sample schema, GISLINK join, reuse terms, and measured freshness before writing an importer.",
  },
  {
    id: "tn-sullivan-register-of-deeds",
    name: "Sullivan County Register of Deeds",
    state: "TN",
    jurisdictionName: "Sullivan",
    jurisdictionType: "county",
    authoritativeUrl: "https://sullivancountytn.gov/register-of-deeds/",
    intendedUse: "transfer_verification",
    transport: "manual_review",
    status: "access_review",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Use for bounded deed verification until access/export terms and instrument fields are confirmed.",
  },
  {
    id: "va-pittsylvania-gis",
    name: "Pittsylvania County GIS",
    state: "VA",
    jurisdictionName: "Pittsylvania",
    jurisdictionType: "county",
    authoritativeUrl: "https://www.pittsylvaniacountyva.gov/285/Maps-GIS",
    intendedUse: "parcel_identity",
    transport: "web_portal",
    status: "access_review",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Research candidate. Prove current fields, sale history availability, and permitted bulk access before adapter work.",
  },
  {
    id: "va-danville-parcels",
    name: "Danville Parcel Layer",
    state: "VA",
    jurisdictionName: "Danville",
    jurisdictionType: "independent_city",
    authoritativeUrl: "https://gis.danvilleva.gov/server/rest/services/WebLoGIStics/Main_WL/MapServer/5",
    intendedUse: "parcel_identity",
    transport: "arcgis_rest",
    status: "schema_verified",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Parcel metadata is identified, but production activation still requires bounded field mapping, reuse review, and freshness evidence.",
  },
  {
    id: "va-danville-sales",
    name: "Danville Residential Sales",
    state: "VA",
    jurisdictionName: "Danville",
    jurisdictionType: "independent_city",
    authoritativeUrl: "https://gis.danvilleva.gov/server/rest/services/Real_Estate/RealEstateDashboard/MapServer/0",
    intendedUse: "sales_history",
    transport: "arcgis_rest",
    status: "blocked",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Blocked for current buyer activity until the newest usable sale date is independently verified or a replacement source is selected.",
  },
  {
    id: "sc-york-gis",
    name: "York County GIS Data Download",
    state: "SC",
    jurisdictionName: "York",
    jurisdictionType: "county",
    authoritativeUrl: "https://www.yorkcountysc.gov/239/GIS-Data-Download",
    intendedUse: "parcel_assessment",
    transport: "download",
    status: "access_review",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Research-only until schema, joins, sale evidence, reuse terms, and file dates are verified.",
  },
  {
    id: "sc-spartanburg-gis",
    name: "Spartanburg County GIS",
    state: "SC",
    jurisdictionName: "Spartanburg",
    jurisdictionType: "county",
    authoritativeUrl: "https://www.spartanburgcounty.gov/185/Geographic-Information-Systems",
    intendedUse: "parcel_identity",
    transport: "web_portal",
    status: "access_review",
    adapterVersion: null,
    productionEnabled: false,
    notes: "Research-only until exact datasets, fields, terms, freshness, and a bounded sample are verified.",
  },
];

export function listProductionEnabledRealEstateSources() {
  return REAL_ESTATE_SOURCE_CANDIDATES.filter(
    (source) => source.productionEnabled && ["active", "degraded"].includes(source.status),
  );
}
