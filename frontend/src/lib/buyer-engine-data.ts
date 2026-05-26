export type CountyVerificationStatus = "approved" | "historical_only" | "unknown" | "blocked";

export type CountyStatus = {
  county: string;
  sourceType: string;
  dateFormat: string;
  status: "active" | "inactive";
  notes?: string;
};

export type CountySourceRow = {
  county: string;
  state: string;
  source_type: string;
  active: boolean;
  notes?: string | null;
};

export type CountyCapability = {
  county: string;
  state: string;
  status: "active" | "inactive";
  sourceTypes: string[];
  sourceRowCount: number;
  dateFormats: string[];
  notes: string[];
  supportsPast90Days: boolean;
  verificationStatus: CountyVerificationStatus;
  verificationReason: string;
};

export type CountyOperationalRisk = {
  county: string;
  tone: "good" | "warn" | "bad" | "neutral";
  label: string;
  message: string;
};

export type WorkflowStatus = {
  name: string;
  workflowId: string;
  webhookPath?: string;
  status: "production-ready" | "stable-module" | "needs-finish" | "early";
  summary: string;
  recentRuns?: string;
};

export type SearchJobSnapshot = {
  id: string;
  title: string;
  county: string;
  state: string;
  propertyType: string;
  status: "pending" | "processing" | "completed" | "failed";
  dateRange: string;
  buyersFound: number;
  salesAnalyzed: number;
  notes?: string;
};

const countyMetadata: Record<string, { dateFormats: string[] }> = {
  alamance: { dateFormats: ["YYYYMMDD int"] },
  ashe: { dateFormats: ["ISO string"] },
  avery: { dateFormats: ["YYYYMMDD int"] },
  beaufort: { dateFormats: ["epoch ms"] },
  bladen: { dateFormats: ["YYYY int (year only)"] },
  brunswick: { dateFormats: ["MM/DD/YYYY"] },
  burke: { dateFormats: ["epoch ms"] },
  buncombe: { dateFormats: ["YYYYMMDD string"] },
  cabarrus: { dateFormats: ["SaleYear + SaleMonth"] },
  carteret: { dateFormats: ["epoch ms"] },
  catawba: { dateFormats: ["YYYY-MM-DD DateOnly string"] },
  cherokee: { dateFormats: ["SaleYear + SaleMonth"] },
  chowan: { dateFormats: ["epoch ms"] },
  craven: { dateFormats: ["epoch ms"] },
  cumberland: { dateFormats: ["ISO string"] },
  currituck: { dateFormats: ["epoch ms"] },
  davidson: { dateFormats: ["SaleYear + SaleMonth"] },
  davie: { dateFormats: ["SaleYear + SaleMonth"] },
  durham: { dateFormats: ["epoch ms"] },
  duplin: { dateFormats: ["MM/DD/YYYY string"] },
  edgecombe: { dateFormats: ["epoch ms"] },
  forsyth: { dateFormats: ["epoch ms"] },
  gaston: { dateFormats: ["epoch ms"] },
  granville: { dateFormats: ["epoch ms"] },
  guilford: { dateFormats: ["epoch ms"] },
  harnett: { dateFormats: ["SaleYear + SaleMonth"] },
  haywood: { dateFormats: ["epoch ms"] },
  henderson: { dateFormats: ["epoch ms"] },
  hoke: { dateFormats: ["YYYYMMDD int"] },
  iredell: { dateFormats: ["MM/DD/YYYY"] },
  jackson: { dateFormats: ["epoch ms"] },
  lee: { dateFormats: ["epoch ms"] },
  lincoln: { dateFormats: ["YYYYMMDD int"] },
  macon: { dateFormats: ["epoch ms"] },
  mecklenburg: { dateFormats: ["epoch ms"] },
  moore: { dateFormats: ["epoch ms"] },
  nash: { dateFormats: ["epoch ms"] },
  "new hanover": { dateFormats: ["ISO datetime string"] },
  onslow: { dateFormats: ["DD-MON-YY"] },
  orange: { dateFormats: ["epoch ms"] },
  pamlico: { dateFormats: ["epoch ms"] },
  pender: { dateFormats: ["epoch ms"] },
  person: { dateFormats: ["MM/DD/YYYY"] },
  pitt: { dateFormats: ["MM/YYYY"] },
  randolph: { dateFormats: ["epoch ms"] },
  robeson: { dateFormats: ["YYYYMMDD int"] },
  rockingham: { dateFormats: ["epoch ms"] },
  rowan: { dateFormats: ["epoch ms"] },
  rutherford: { dateFormats: ["epoch ms"] },
  sampson: { dateFormats: ["YYYY-MM-DD datetime string"] },
  surry: { dateFormats: ["SaleYear + SaleMonth"] },
  wake: { dateFormats: ["epoch ms"] },
  warren: { dateFormats: ["epoch ms"] },
  wilson: { dateFormats: ["YYYYMMDD int"] },
  yadkin: { dateFormats: ["epoch ms"] },
};

const countyVerificationOverrides: Record<
  string,
  {
    supportsPast90Days: boolean;
    verificationStatus: CountyVerificationStatus;
    verificationReason: string;
  }
> = {
  alamance: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  ashe: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Ashe County parcel FeatureServer exposes exact deed date, sale price, owner, mailing address, parcel ID, deed book/page, value fields, and building-value land signals for past-90-day buyer sweeps.",
  },
  avery: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Avery County parcel viewer FeatureServer exposes YYYYMMDD deed dates, sale price, owner, mailing address, property address, parcel ID, deed book/page, value fields, acreage, and building-value/build-year land signals for past-90-day buyer sweeps.",
  },
  beaufort: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Beaufort County parcel FeatureServer exposes exact deed date, sale price, owner, mailing address, property address, deed book/page, deed image link, values, and building-count/value land signals for past-90-day buyer sweeps.",
  },
  bladen: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Bladen only exposes year-level sale dates, so it is not approved for a true past-90-day buyer sweep.",
  },
  brunswick: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Brunswick parcel tax layer exposes recent deed date, current owner, mailing address, site address, parcel ID, deed book/page, and vacant/improvement signals for past-90-day buyer sweeps. Sale price is unavailable, and workflow runs currently use a freshest-record cap to avoid n8n timeouts.",
  },
  burke: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Burke County parcel service exposes exact package sale date, sale price, owner, mailing address, property address, parcel ID, deed book/page, acreage, land class, and assessed building/land values for past-90-day buyer sweeps.",
  },
  buncombe: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  cabarrus: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
  },
  carteret: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  catawba: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Catawba County SearchLayers cc_owner table exposes sale_date, sale_amount, owner, mailing address, deed book/page, value fields, building year, and class fields for past-90-day buyer sweeps.",
  },
  cherokee: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
  },
  chowan: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "NC OneMap parcel feed exposes current owner, mailing address, parcel, vacant/structure signal, and last-sale date for past-90-day buyer sweeps. Sale price is unavailable in this feed.",
  },
  craven: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  cumberland: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  currituck: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "NC OneMap parcel feed exposes current owner, mailing address, parcel, vacant/structure signal, valuation, and last-sale date for past-90-day buyer sweeps.",
  },
  davidson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
  },
  davie: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Davie County Parcel_Sales MapServer exposes 2026 sale year/month, buyer/current owner name, mailing address, deed reference, value fields, acreage, and no-building land signal. Month-level sale timing is acceptable for operator-facing 90-day sweeps.",
  },
  durham: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Recent successful live runs make Durham approved for operator-facing past-90-day sweeps.",
  },
  duplin: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Duplin County PublicAccessMainGISDB parcels layer exposes 2026 deed dates, sale price, current owner, mailing address, site address, deed book/page, and no-building land signals. App-server prefetch applies exact 90-day filtering from the MM/DD/YYYY string date.",
  },
  edgecombe: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Edgecombe County webmap parcel layer exposes deeddate, sale price, owner, mailing address, property location, deed book/page, parcel identifiers, value fields, and building-value land signals for past-90-day buyer sweeps.",
  },
  forsyth: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Forsyth SalesApp exposes recent transfer dates/prices and NCPTS Cloud parcel detail exposes current buyer-owner and mailing data by PIN. Property-type classification is inferred from available transfer fields.",
  },
  gaston: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  granville: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Granville County parcel FeatureServer exposes exact deed date, sale price, owner, mailing address, property address, deed book/page, value fields, and building-value land signals for past-90-day buyer sweeps.",
  },
  guilford: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Recent successful live runs make Guilford approved for operator-facing past-90-day sweeps.",
  },
  harnett: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
  },
  haywood: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Haywood County Map2 parcel service exposes exact sale date, sale price, buyer/current owner, mailing address, property address, parcel ID, deed reference, acreage, land/building values, and land-use signals for past-90-day buyer sweeps.",
  },
  henderson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  hoke: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  iredell: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Iredell is split into historical yearly source rows and is not yet approved as a true past-90-day buyer feed.",
  },
  jackson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "NC OneMap parcel feed exposes current owner, mailing address, parcel, vacant/structure signal, valuation, and last-sale date for past-90-day buyer sweeps.",
  },
  lee: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Lee is currently represented by year-specific source rows and is not yet approved as a true past-90-day buyer feed.",
  },
  lincoln: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason:
      "Lincoln's official GIS feed is reachable, but the latest observed sale data is stale and not approved for past-90-day buyer sweeps.",
  },
  macon: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Macon's current live source is historical and not approved for a real past-90-day sweep.",
  },
  mecklenburg: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  moore: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  nash: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Nash County OpenGov Parcel Records layer exposes exact sale date, sale price, buyer/current owner, mailing address, site address, deed book/page, property type, land value, and building-value land signals for past-90-day buyer sweeps.",
  },
  "new hanover": {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  onslow: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  orange: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Orange County parcel service exposes recent sold date, current owner, mailing address, deed reference, valuation, and no-building land signals for past-90-day buyer sweeps. App-server prefetch is used before n8n scoring for timeout safety.",
  },
  pamlico: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "NC OneMap parcel feed exposes current owner, mailing address, parcel, vacant/structure signal, valuation, and last-sale date for past-90-day buyer sweeps.",
  },
  pender: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  person: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  pitt: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
  },
  randolph: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "NC OneMap parcel feed exposes current owner, mailing address, parcel, vacant/structure signal, and last-sale date for past-90-day buyer sweeps. Sale price is not available in this feed.",
  },
  robeson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Robeson is approved for past-90-day sweeps and is the safest current launch path in the live workflow.",
  },
  rockingham: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "NC OneMap parcel feed exposes current owner, mailing address, parcel, vacant/structure signal, valuation, and last-sale date for past-90-day buyer sweeps.",
  },
  rowan: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Source coverage is approved for past-90-day sweeps, though workflow-cloud fetches remain cautionary.",
  },
  rutherford: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  sampson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Official Sampson County parcel feed exposes recent record date, current owner, mailing address, site address, sale price, deed reference, and land-use signals for past-90-day buyer sweeps.",
  },
  surry: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Surry is currently backed by historical yearly parcel layers and is not approved as a true past-90-day buyer feed.",
  },
  wake: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Wake source coverage is approved for past-90-day sweeps, and land runs now use app-server prefetch before n8n scoring.",
  },
  warren: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  wilson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
  wilkes: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason:
      "Wilkes parcel service exposes recent sale date, sale price, current owner, mailing address lines, parcel ID/PIN, deed book/page, land value, building value, year built, and land-type signals for past-90-day buyer sweeps.",
  },
  yadkin: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
};

export const fallbackCountySourceRows: CountySourceRow[] = [
  { county: "Alamance", state: "NC", source_type: "arcgis_alamance", active: true, notes: "apps.alamance-nc.com source is live." },
  { county: "Ashe", state: "NC", source_type: "arcgis", active: true, notes: "Official AsheCountyParcels FeatureServer. DeedDate ISO string, SalePrice, Name1 buyer field, mailing fields, parcel IDs, deed book/page, and ParcelBuil land signal." },
  { county: "Avery", state: "NC", source_type: "arcgis", active: true, notes: "Official Avery_AGOL Parcels_Reval FeatureServer. DEED_DATE YYYYMMDD int, SALEPRICE, OWNER_NAME/NAME_1, mailing/site fields, deed book/page, acreage, and BUILD_VALU/AYB land signals." },
  { county: "Beaufort", state: "NC", source_type: "arcgis", active: true, notes: "Official Beaufort_Service parcel FeatureServer. date_dt epoch ms, SALE_PRICE, NAME1/NAME2, mailing/site address fields, DEED_BOOK/DEED_PAGE/deed_link, value fields, and BLDG_VAL/NBR_BLDG land signals." },
  { county: "Bladen", state: "NC", source_type: "arcgis_bladen", active: true, notes: "Year-only deed dates." },
  { county: "Brunswick", state: "NC", source_type: "arcgis", active: true, notes: "Official TaxParcels layer. DeedDate MM/DD/YYYY, Name1/Name2 buyer fields, mailing/site address fields, and vacant/improvement signals. Sale price unavailable; workflow uses freshest-record cap." },
  { county: "Burke", state: "NC", source_type: "arcgis", active: true, notes: "Official Burke ProdParcelViewFC parcel layer. PKG_SALE_DATE epoch ms, PKG_SALE_PRICE, PROPERTY_OWNER, owner mailing fields, location address, deed book/page, acreage, land class, and assessed land/building values." },
  { county: "Buncombe", state: "NC", source_type: "arcgis_buncombe", active: true, notes: "YYYYMMDD string date format." },
  { county: "Cabarrus", state: "NC", source_type: "arcgis_cabarrus", active: true, notes: "Parcel ID uses PIN14." },
  { county: "Carteret", state: "NC", source_type: "arcgis", active: true, notes: "DeedDate_2 epoch ms. SaleImprovedOrVacant distinguishes vacant vs improved sales." },
  { county: "Catawba", state: "NC", source_type: "arcgis", active: true, notes: "Official SearchLayers cc_owner table. sale_date DateOnly string, sale_amount, owner/owner2, mailing address, deed_bk/deed_pg, value fields, yr_built, and class/bldg_value land signals." },
  { county: "Cherokee", state: "NC", source_type: "arcgis_cherokee", active: true, notes: "Month and year sale timing." },
  { county: "Chowan", state: "NC", source_type: "arcgis", active: true, notes: "NC OneMap parcel feed. saledate epoch ms and ownname/mailadd buyer fields. Sale price unavailable." },
  { county: "Craven", state: "NC", source_type: "arcgis_craven", active: true, notes: "SALE_DATE epoch ms." },
  { county: "Cumberland", state: "NC", source_type: "arcgis_cumberland", active: true, notes: "PKG_SALE_DATE ISO string." },
  { county: "Currituck", state: "NC", source_type: "arcgis", active: true, notes: "NC OneMap parcel feed. saledate epoch ms and ownname/mailadd buyer fields. parval used as valuation proxy." },
  { county: "Davidson", state: "NC", source_type: "arcgis_davidson", active: true, notes: "SaleMonth1 and SaleYear1 fields." },
  { county: "Davie", state: "NC", source_type: "arcgis", active: true, notes: "Official Parcel_Sales MapServer. saleyear/salemonth month-level timing, name1/name2 buyer fields, mailing address fields, deed_bk_pg, value fields, acreage, and parcelbuildingvalue land signal." },
  { county: "Durham", state: "NC", source_type: "arcgis_durham", active: true, notes: "PKG_SALE_DATE epoch ms." },
  { county: "Duplin", state: "NC", source_type: "arcgis", active: true, notes: "Official PublicAccessMainGISDB Parcels layer. DeedDate MM/DD/YYYY string, SalePrice, Name1/Name2 buyer fields, mailing/site address fields, deed book/page, and ActualYearBuilt land signal. App-server prefetch applies exact date filtering." },
  { county: "Edgecombe", state: "NC", source_type: "arcgis", active: true, notes: "Official webmap Parcels layer. deeddate epoch ms, salepr, owner, mailing fields, location, bk_pg, landval/bldgval/netval, and bldgval/pclass/description land signals." },
  { county: "Forsyth", state: "NC", source_type: "arcgis_forsyth", active: true, notes: "SalesApp transfer feed joined to NCPTS Cloud parcel detail by PIN for current owner and mailing data. Cash-buyer scoring disabled; property type is inferred." },
  { county: "Gaston", state: "NC", source_type: "arcgis_gaston", active: true, notes: "SALEDATE epoch ms." },
  { county: "Granville", state: "NC", source_type: "arcgis", active: true, notes: "Official Granville_Service Parcels_Polygon FeatureServer. DeedDate epoch ms, SalePrice, OwnerName1/OwnerName2, mailing/site address fields, DeedBookPage, value fields, and BuildingValue land signal." },
  { county: "Guilford", state: "NC", source_type: "arcgis_guilford", active: true, notes: "PKG_SALE_DATE epoch ms." },
  { county: "Harnett", state: "NC", source_type: "arcgis_harnett", active: true, notes: "SaleMonth and SaleYear fields." },
  { county: "Haywood", state: "NC", source_type: "arcgis", active: true, notes: "Official Haywood County Map2 parcel layer. Sale_Date epoch ms, Sale_Price, Owner_1/Owner_2, mailing fields, property address, LegalRef deed reference, acreage, land/building values, land descriptions, and sale validity." },
  { county: "Henderson", state: "NC", source_type: "arcgis_henderson", active: true, notes: "PKG_SALE_DATE epoch ms." },
  { county: "Hoke", state: "NC", source_type: "arcgis_hoke", active: true, notes: "DEED_DATE YYYYMMDD integer." },
  { county: "Iredell", state: "NC", source_type: "arcgis_iredell", active: true, notes: "Historical yearly rows only." },
  { county: "Jackson", state: "NC", source_type: "arcgis", active: true, notes: "NC OneMap parcel feed. saledate epoch ms and ownname/mailadd buyer fields. parval used as valuation proxy." },
  { county: "Lee", state: "NC", source_type: "arcgis_lee", active: true, notes: "Historical yearly rows only." },
  { county: "Lincoln", state: "NC", source_type: "arcgis", active: true, notes: "AMDTSL YYYYMMDD int. Feed is reachable, but observed sales are stale and not approved for past-90-day sweeps." },
  { county: "Macon", state: "NC", source_type: "arcgis_macon", active: true, notes: "Historical source range only." },
  { county: "Mecklenburg", state: "NC", source_type: "arcgis_mecklenburg", active: true, notes: "Large paged source." },
  { county: "Moore", state: "NC", source_type: "arcgis_moore", active: true, notes: "RECENT_SALEDT epoch ms." },
  { county: "Nash", state: "NC", source_type: "arcgis", active: true, notes: "Official OpenGov Parcel Records layer. SALEDATE epoch ms, SALEPRICE, OWNER1/OWNER2, mailing/site fields, deed book/page, PROPTYPE/LANDTYPE, and TOT_B_VAL land signal." },
  { county: "New Hanover", state: "NC", source_type: "arcgis_newhanover", active: true, notes: "ISO datetime string." },
  { county: "Onslow", state: "NC", source_type: "arcgis_onslow", active: true, notes: "DD-MON-YY date format." },
  { county: "Orange", state: "NC", source_type: "arcgis", active: true, notes: "Official WebParcelService. DATESOLD epoch ms, OWNER1/OWNER2 buyer fields, mailing address fields, DEEDREF deed reference, BLDGVALUE/BLDGCNT/YEARBUILT land signal. Sale price unavailable; app-server prefetch active." },
  { county: "Pamlico", state: "NC", source_type: "arcgis", active: true, notes: "NC OneMap parcel feed. saledate epoch ms and ownname/mailadd buyer fields. parval used as valuation proxy." },
  { county: "Pender", state: "NC", source_type: "arcgis_pender", active: true, notes: "DATE epoch ms." },
  { county: "Person", state: "NC", source_type: "arcgis_person", active: true, notes: "Sale_Date MM/DD/YYYY." },
  { county: "Pitt", state: "NC", source_type: "arcgis_pitt", active: true, notes: "SalesMonthYear MM/YYYY." },
  { county: "Randolph", state: "NC", source_type: "arcgis", active: true, notes: "NC OneMap parcel feed. saledate epoch ms and ownname/mailadd buyer fields. Sale price and lender unavailable." },
  { county: "Robeson", state: "NC", source_type: "arcgis", active: true, notes: "ArcGIS parcel layer." },
  { county: "Rockingham", state: "NC", source_type: "arcgis", active: true, notes: "NC OneMap parcel feed. saledate epoch ms and ownname/mailadd buyer fields. parval used as valuation proxy." },
  { county: "Rowan", state: "NC", source_type: "arcgis_rowan", active: true, notes: "DATESOLD epoch ms." },
  { county: "Rutherford", state: "NC", source_type: "arcgis_rutherford", active: true, notes: "Deed_Date epoch ms." },
  { county: "Sampson", state: "NC", source_type: "arcgis", active: true, notes: "Official Parcels FeatureServer. DATE_RECOR datetime string, CURRENT_OW buyer field, mailing/site address fields, SALE_PRICE, BK_PG/DEED, and SEG_TYPE_D/PARCEL_CLA/YEAR_BUILT land signals." },
  { county: "Surry", state: "NC", source_type: "arcgis_surry", active: true, notes: "Historical yearly rows only." },
  { county: "Wake", state: "NC", source_type: "arcgis_wake", active: true, notes: "SALE_DATE epoch ms." },
  { county: "Warren", state: "NC", source_type: "arcgis_warren", active: true, notes: "DEEDDATE epoch ms." },
  { county: "Wilkes", state: "NC", source_type: "arcgis", active: true, notes: "Official Wilkes County Parcels_Data layer. SALEDATE epoch ms, SALEPRICE, OWNER1, mailing address lines, PIN, parcel ID, land/building values, year built, sale validity, and land type." },
  { county: "Wilson", state: "NC", source_type: "arcgis_wilson", active: true, notes: "DateSold YYYYMMDD int." },
  { county: "Yadkin", state: "NC", source_type: "arcgis_yadkin", active: true, notes: "DEED_DATE epoch ms." },
];

export function buildCountyCapabilities(rows: CountySourceRow[]): CountyCapability[] {
  const grouped = new Map<string, CountySourceRow[]>();

  for (const row of rows) {
    const key = row.county.trim().toLowerCase();
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return [...grouped.entries()]
    .map(([key, group]) => {
      const primary = group[0];
      const sourceTypes = [...new Set(group.map((row) => row.source_type))];
      const notes = [...new Set(group.map((row) => row.notes?.trim()).filter((note): note is string => Boolean(note)))];
      const status = group.some((row) => row.active) ? "active" : "inactive";
      const metadata = countyMetadata[key];
      const verification = countyVerificationOverrides[key] ?? {
        supportsPast90Days: false,
        verificationStatus: "unknown" as CountyVerificationStatus,
        verificationReason: "County source is live, but 90-day suitability has not been verified in the app layer yet.",
      };

      if (status === "inactive") {
        return {
          county: primary.county,
          state: primary.state,
          status,
          sourceTypes,
          sourceRowCount: group.length,
          dateFormats: metadata?.dateFormats ?? ["unknown"],
          notes,
          supportsPast90Days: false,
          verificationStatus: "blocked" as CountyVerificationStatus,
          verificationReason:
            notes[0] ??
            "County source is inactive in the project app and should not be treated as launchable.",
        } satisfies CountyCapability;
      }

      return {
        county: primary.county,
        state: primary.state,
        status,
        sourceTypes,
        sourceRowCount: group.length,
        dateFormats: metadata?.dateFormats ?? ["unknown"],
        notes,
        supportsPast90Days: verification.supportsPast90Days,
        verificationStatus: verification.verificationStatus,
        verificationReason: verification.verificationReason,
      } satisfies CountyCapability;
    })
    .sort((left, right) => left.county.localeCompare(right.county));
}

export const fallbackCountyCapabilities = buildCountyCapabilities(fallbackCountySourceRows);

export const activeCounties: CountyStatus[] = fallbackCountyCapabilities.map((county) => ({
  county: county.county,
  sourceType: county.sourceTypes.join(", "),
  dateFormat: county.dateFormats.join(", "),
  status: county.status,
  notes: county.notes[0],
}));

export const workflows: WorkflowStatus[] = [
  {
    name: "blackspire-buyer-engine",
    workflowId: "VvMHSIbycYCx4CZN",
    webhookPath: "buyer-engine",
    status: "production-ready",
    summary:
      "Full search intake, county fetch, normalization, buyer scoring, report persistence, and webhook response path are live.",
    recentRuns: "Recent Wake land runs now complete through app-server prefetch plus the live n8n scoring path.",
  },
  {
    name: "viral-video-factory",
    workflowId: "VSLwewZ63PDbuVPi",
    webhookPath: "viral-video-factory",
    status: "needs-finish",
    summary:
      "Main orchestrator works across script, Pexels, voiceover, assembly, and Drive upload, but still stops short of social publishing.",
    recentRuns: "20 recent runs: 13 success, 7 error",
  },
  {
    name: "mod-script-generator",
    workflowId: "n6Tr0z6joHvzN1cQ",
    status: "stable-module",
    summary: "Reusable OpenAI-backed script generation module for the video factory.",
    recentRuns: "21 recent runs: 19 success, 2 error",
  },
  {
    name: "mod-pexels-search",
    workflowId: "qEVM2LF35KMD0XIb",
    status: "stable-module",
    summary: "Reusable video search module for five-query clip retrieval and extraction.",
    recentRuns: "18 recent runs: 17 success, 1 error",
  },
  {
    name: "mod-voiceover",
    workflowId: "cQgczaWAG0QhKrlC",
    status: "stable-module",
    summary: "ElevenLabs-driven voiceover generation plus Drive upload/public media handoff.",
    recentRuns: "15 recent runs: 14 success",
  },
  {
    name: "mod-video-assembler",
    workflowId: "WL1WhCpS94tMoX6P",
    status: "needs-finish",
    summary: "Render assembly module is usable, but it is the most failure-prone part of the video pipeline.",
    recentRuns: "14 recent runs: 10 success, 4 error",
  },
];

export const searchJobSnapshots: SearchJobSnapshot[] = [
  {
    id: "sj-wake-001",
    title: "Wake land buyers sweep",
    county: "Wake",
    state: "NC",
    propertyType: "land",
    status: "completed",
    dateRange: "2025-04-15 to 2025-05-24",
    buyersFound: 0,
    salesAnalyzed: 35,
    notes: "Completed through app-server Wake prefetch with the live scoring pipeline.",
  },
  {
    id: "sj-durham-001",
    title: "Durham investor pulse",
    county: "Durham",
    state: "NC",
    propertyType: "land",
    status: "completed",
    dateRange: "2023-01-01 to 2024-12-31",
    buyersFound: 48,
    salesAnalyzed: 211,
    notes: "Recovered after source URL correction.",
  },
  {
    id: "sj-guilford-001",
    title: "Guilford repeat buyer command",
    county: "Guilford",
    state: "NC",
    propertyType: "land",
    status: "completed",
    dateRange: "2024-01-01 to 2024-12-31",
    buyersFound: 33,
    salesAnalyzed: 124,
    notes: "Healthy reference county for frontend wiring and QA.",
  },
];

export const environmentReadiness = [
  { key: "OPENAI_API_KEY", purpose: "AI generation modules and server actions", status: "placeholder only" },
  { key: "SUPABASE_URL", purpose: "Buyer Engine read/write integration", status: "placeholder only" },
  { key: "SUPABASE_ANON_KEY", purpose: "client-side Supabase access", status: "placeholder only" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", purpose: "server-side admin and workflow handoff", status: "placeholder only" },
  { key: "STRIPE_SECRET_KEY", purpose: "future monetization and billing", status: "placeholder only" },
];

export const pendingWork = [
  "Monitor the new Wake app-server prefetch path and extend the same escape hatch to other heavy counties if cloud fetch latency reappears.",
  "Create the first operator account in /auth and then retire the default-user fallback bridge.",
  "Replace dashboard sample snapshots with fully live operational metrics and history.",
  "Bring county source administration and role management into an admin surface.",
];

export function getCountyCapability(county: string, capabilities: CountyCapability[] = fallbackCountyCapabilities) {
  const normalizedCounty = county.trim().toLowerCase();
  return capabilities.find((item) => item.county.trim().toLowerCase() === normalizedCounty) ?? null;
}

export function getCountyVerificationTone(status: CountyVerificationStatus) {
  if (status === "approved") return "good";
  if (status === "historical_only") return "warn";
  if (status === "blocked") return "bad";
  return "neutral";
}

export function getCountyLaunchBlock(county: string, propertyType: string, capabilities: CountyCapability[] = fallbackCountyCapabilities) {
  const capability = getCountyCapability(county, capabilities);
  const normalizedCounty = county.trim().toLowerCase();
  const normalizedPropertyType = propertyType.trim().toLowerCase();

  if (capability?.status === "inactive") {
    return {
      blocked: true,
      reason: capability.verificationReason,
    };
  }

  return {
    blocked: false,
    reason: "",
  };
}

export function getCountyOperationalRisk(county: string, propertyType: string) {
  const normalizedCounty = county.trim().toLowerCase();
  const normalizedPropertyType = propertyType.trim().toLowerCase();

  if (normalizedCounty === "wake" && normalizedPropertyType === "land") {
    return {
      county,
      tone: "good",
      label: "prefetch active",
      message:
        "Wake land searches now prefetch county sales through the app server and hand raw sales to n8n for scoring, which cleared the earlier timeout path.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "beaufort") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Beaufort uses the official county parcel FeatureServer with recent deed dates, sale price, owner/mailing fields, property address, deed book/page, deed image link, values, and building-value/count land signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "ashe") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Ashe uses the official county parcel FeatureServer with recent deed dates, sale price, buyer/mailing fields, parcel IDs, deed book/page, and building-value land signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "avery") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Avery uses the official county parcel viewer FeatureServer with 2026 deed records, sale price, owner/mailing data, property address, deed book/page, acreage, and building-value/build-year land signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "robeson") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Robeson completed successfully in the current live workflow and is the safest launch path right now.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "rowan") {
    return {
      county,
      tone: "warn",
      label: "cloud caution",
      message:
        "Rowan responds from local testing, but a live n8n-cloud run failed with a 403 during county fetch. Treat it as cautionary until reverified.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "lincoln") {
    return {
      county,
      tone: "warn",
      label: "historical only",
      message:
        "Lincoln's county source is reachable, but the observed sale feed is stale and should only be used as a historical reference until fresher data is verified.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "forsyth") {
    return {
      county,
      tone: "warn",
      label: "joined source",
      message:
        "Forsyth uses live SalesApp transfers joined to NCPTS Cloud parcel ownership by PIN. Buyer identity is inferred from current owner after transfer, and property-type labels are less precise than parcel-native counties.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "brunswick") {
    return {
      county,
      tone: "good",
      label: "deed feed",
      message:
        "Brunswick uses the official parcel tax layer with current owner, mailing address, deed date, and vacant/improvement signals. Sale price is unavailable, and n8n currently caps the freshest records to stay under code-node timeout limits.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "burke") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Burke uses the official county parcel service with recent package sale dates, sale price, owner/mailing data, location address, deed book/page, acreage, land class, and assessed building/land values.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "orange") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Orange uses the official county parcel service with recent sold dates, owner/mailing fields, deed references, and no-building land signals. App-server prefetch feeds n8n to avoid cloud fetch timeouts; sale price is unavailable, so spend totals use valuation context only.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "sampson") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Sampson uses the official parcel FeatureServer with recent record dates, current owner mailing data, site address, sale price, deed reference, and land-use/build-year signals for 90-day land buyer sweeps.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "davie") {
    return {
      county,
      tone: "good",
      label: "month-level live",
      message:
        "Davie uses the official county Parcel_Sales MapServer with current owner, mailing, deed, acreage, value, and no-building land signals. Sale timing is month-level, so 90-day sweeps are approximate to the month.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "catawba") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Catawba uses the official county SearchLayers owner table with exact sale dates, sale amount, owner/mailing fields, deed book/page, and land signals from building value, year built, and class.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "edgecombe") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Edgecombe uses the official county parcel layer with recent deed dates, sale price, owner/mailing fields, property location, deed reference, parcel ID, values, and building-value land signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "nash") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Nash uses the official county Parcel Records layer with recent sale dates, sale price, owner/mailing fields, property address, deed reference, and zero-building land signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "granville") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Granville uses the official county parcel FeatureServer with recent deed dates, sale price, owner/mailing fields, property address, deed reference, values, and building-value land signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "haywood") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Haywood uses the official county Map2 parcel service with recent sale dates, sale price, owner/mailing fields, property address, deed reference, acreage, land/building values, and land-use signals.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "duplin") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Duplin uses the official county parcel layer with current owner, mailing address, site address, sale price, deed reference, and no-building land signals. The app prefilters exact 90-day dates from the county's MM/DD/YYYY string field before n8n scoring.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "durham" || normalizedCounty === "guilford") {
    return {
      county,
      tone: "good",
      label: "stable reference",
      message:
        "This county has recent successful runs and is a strong candidate for operator testing and frontend QA.",
    } satisfies CountyOperationalRisk;
  }

  if (normalizedCounty === "wilkes") {
    return {
      county,
      tone: "good",
      label: "verified live",
      message:
        "Wilkes uses the official countywide parcel service with recent sale dates, sale price, current owner, mailing address lines, parcel ID/PIN, land value, building value, year built, sale validity, and land-type signals.",
    } satisfies CountyOperationalRisk;
  }

  if (
    normalizedCounty === "currituck" ||
    normalizedCounty === "chowan" ||
    normalizedCounty === "jackson" ||
    normalizedCounty === "pamlico" ||
    normalizedCounty === "randolph" ||
    normalizedCounty === "rockingham"
  ) {
    return {
      county,
      tone: "good",
      label: "statewide feed",
      message:
        "This county is backed by current NC OneMap last-sale records with buyer and mailing data. Sale price is unavailable, so spend totals use available valuation context and should be treated as incomplete.",
    } satisfies CountyOperationalRisk;
  }

  return {
    county,
    tone: "neutral",
    label: "no fresh signal",
    message:
      "No recent operator-specific launch signal is pinned here yet. County support exists, but live reliability is not freshly classified in the frontend.",
  } satisfies CountyOperationalRisk;
}

export function getSystemStats() {
  const activeCountyCount = fallbackCountyCapabilities.filter((county) => county.status === "active").length;
  const completedRuns = searchJobSnapshots.filter((job) => job.status === "completed").length;
  const totalBuyers = searchJobSnapshots.reduce((sum, job) => sum + job.buyersFound, 0);

  return {
    activeCountyCount,
    completedRuns,
    totalBuyers,
  };
}
