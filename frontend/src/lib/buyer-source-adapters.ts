import type { SearchJobRecord } from "./buyer-engine-server";

export type BuyerAdapterSource = { source_url: string | null };
export type BuyerArcgisPayload = {
  features?: Array<{ attributes?: Record<string, unknown>; properties?: Record<string, unknown> }>;
  error?: { message?: string };
};
export type BuyerSourceAdapterTransport = {
  resolveSource: (county: string, state: string) => Promise<BuyerAdapterSource | null>;
  getJson: (url: string, timeoutMs: number) => Promise<BuyerArcgisPayload>;
  postFormJson: (url: string, params: URLSearchParams, timeoutMs: number) => Promise<BuyerArcgisPayload>;
  postForsythJson: (formattedPin: string) => Promise<Record<string, unknown> | null>;
};

// Pure adapter composition: no authentication, environment reads or implicit
// source/network access. The caller supplies captured source authority and owns
// transport budgets/cleanup. null means no adapter; [] is a successful empty read.
export function createBuyerSourceAdapters(transport: BuyerSourceAdapterTransport) {
  const getActiveCountySource = transport.resolveSource;
  const fetchJsonWithTimeout = (url: string, timeoutMs = 20000) => transport.getJson(url, timeoutMs);
  const postArcgisQueryWithTimeout = (url: string, params: URLSearchParams, timeoutMs = 20000) => transport.postFormJson(url, params, timeoutMs);

function isWakeLandJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "wake" && job.property_type.trim().toLowerCase() === "land";
}

function isLincolnLandJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "lincoln" && job.property_type.trim().toLowerCase() === "land";
}

function isForsythJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "forsyth";
}

function isMecklenburgJob(job: SearchJobRecord) {
  return job.county.trim().toLowerCase() === "mecklenburg";
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

function getMecklenburgDateRangeFilter(job: SearchJobRecord) {
  const filters = ["Price > 0"];

  if (job.date_range_start) {
    filters.push(`Sales_Date >= DATE '${job.date_range_start} 00:00:00'`);
  }

  if (job.date_range_end) {
    filters.push(`Sales_Date <= DATE '${job.date_range_end} 23:59:59'`);
  }

  if (job.property_type.trim().toLowerCase().includes("land")) {
    filters.push("(Building_Value IS NULL OR Building_Value = 0 OR Year_Built IS NULL OR Year_Built = 0)");
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
  return transport.postForsythJson(formattedPin);
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

async function fetchMecklenburgCountyRawSales(job: SearchJobRecord) {
  const fallbackUrl = "https://gis.charlottenc.gov/arcgis/rest/services/CLT_Ex/CLTEx_MoreInfo/MapServer/4";
  const source = await getActiveCountySource(job.county, job.state);
  const baseUrl = (source?.source_url || fallbackUrl).split("?")[0];
  const pageSize = 5000;
  const maxPages = 10;
  const rawSales: Array<Record<string, unknown>> = [];

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      where: getMecklenburgDateRangeFilter(job),
      outFields:
        "Tax_ID,Common_PID,PID,Account_Type,Property_Use,Total_Acreage,Property_URL,Municipality,Building_Value,Land_Value,Total_Value,Owner_FirstName,Owner_LastName,Mailing_Address,City,State,Zip_Code,Sales_Date,Price,TypeOfDeed,Legal_Reference,Legal_Reference_URL,Grantor,Building_Type,Building_Code,Year_Built,Heated_Sqft,Units,Location,OBJECTID",
      returnGeometry: "false",
      orderByFields: "Sales_Date DESC",
      resultRecordCount: String(pageSize),
      resultOffset: String(page * pageSize),
      f: "json",
    });

    const payload = await postArcgisQueryWithTimeout(`${baseUrl}/query`, params, 30000);

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
        CURRENTOWNERNAME1: [String(row.Owner_FirstName ?? "").trim(), String(row.Owner_LastName ?? "").trim()].filter(Boolean).join(" "),
        CURRENTOWNERNAME2: "",
        CURRENTOWNERADDRESS: String(row.Mailing_Address ?? "").trim(),
        CURRENTOWNERCITYSTZIP: [String(row.City ?? "").trim(), String(row.State ?? "").trim(), String(row.Zip_Code ?? "").trim()].filter(Boolean).join(" "),
        PROPERTYADDRESS: String(row.Location ?? "").trim(),
        LASTQUALIFIEDSALEPRICE: row.Price,
        CURRENTDEEDDATE: row.Sales_Date,
        CURRENTDEEDBKPG: String(row.Legal_Reference ?? "").trim(),
        TAXPIN: String(row.Tax_ID ?? row.Common_PID ?? row.PID ?? "").trim(),
        DEED_URL: String(row.Legal_Reference_URL ?? "").trim(),
        BUILDINGVALUE: row.Building_Value,
        LANDVALUE: row.Land_Value,
        MARKETVALUE: row.Total_Value,
        ACREAGE: row.Total_Acreage,
        PROPCLASS: String(row.Property_Use ?? row.Building_Type ?? "").trim(),
        BUYER_IDENTITY_METHOD: "sales_owner_joined",
        BUYER_IDENTITY_CONFIDENCE: "high",
        BUYER_IDENTITY_REASON: "Mecklenburg sales table already carries the post-sale owner and mailing profile.",
        BUYER_IDENTITY_VERIFIED_AT: new Date().toISOString(),
        _source_type: "arcgis_mecklenburg",
        _no_cash_data: true,
      })),
    );

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rawSales.filter((row) => String(row.CURRENTOWNERNAME1 ?? "").trim());
}

  return { async prefetch(job: SearchJobRecord): Promise<Array<Record<string, unknown>> | null> {
    if (isWakeLandJob(job)) return fetchWakeCountyRawSales(job);
    if (isLincolnLandJob(job)) return fetchLincolnCountyRawSales(job);
    if (isForsythJob(job)) return fetchForsythCountyRawSales(job);
    if (isMecklenburgJob(job)) return fetchMecklenburgCountyRawSales(job);
    if (isBrunswickJob(job)) return fetchBrunswickCountyRawSales(job);
    if (isOrangeJob(job)) return fetchOrangeCountyRawSales(job);
    if (isBeaufortJob(job)) return fetchBeaufortCountyRawSales(job);
    if (isAsheJob(job)) return fetchAsheCountyRawSales(job);
    if (isAveryJob(job)) return fetchAveryCountyRawSales(job);
    if (isBurkeJob(job)) return fetchBurkeCountyRawSales(job);
    if (isWilkesJob(job)) return fetchWilkesCountyRawSales(job);
    if (isHaywoodJob(job)) return fetchHaywoodCountyRawSales(job);
    if (isSampsonJob(job)) return fetchSampsonCountyRawSales(job);
    if (isDavieJob(job)) return fetchDavieCountyRawSales(job);
    if (isCatawbaJob(job)) return fetchCatawbaCountyRawSales(job);
    if (isEdgecombeJob(job)) return fetchEdgecombeCountyRawSales(job);
    if (isNashJob(job)) return fetchNashCountyRawSales(job);
    if (isGranvilleJob(job)) return fetchGranvilleCountyRawSales(job);
    if (isDuplinJob(job)) return fetchDuplinCountyRawSales(job);
    return null;
  }};
}
