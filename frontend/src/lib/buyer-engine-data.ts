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
  bladen: { dateFormats: ["YYYY int (year only)"] },
  buncombe: { dateFormats: ["YYYYMMDD string"] },
  cabarrus: { dateFormats: ["SaleYear + SaleMonth"] },
  cherokee: { dateFormats: ["SaleYear + SaleMonth"] },
  craven: { dateFormats: ["epoch ms"] },
  cumberland: { dateFormats: ["ISO string"] },
  davidson: { dateFormats: ["SaleYear + SaleMonth"] },
  durham: { dateFormats: ["epoch ms"] },
  forsyth: { dateFormats: ["n/a"] },
  gaston: { dateFormats: ["epoch ms"] },
  guilford: { dateFormats: ["epoch ms"] },
  harnett: { dateFormats: ["SaleYear + SaleMonth"] },
  henderson: { dateFormats: ["epoch ms"] },
  hoke: { dateFormats: ["YYYYMMDD int"] },
  iredell: { dateFormats: ["MM/DD/YYYY"] },
  lee: { dateFormats: ["epoch ms"] },
  macon: { dateFormats: ["epoch ms"] },
  mecklenburg: { dateFormats: ["epoch ms"] },
  moore: { dateFormats: ["epoch ms"] },
  "new hanover": { dateFormats: ["ISO datetime string"] },
  onslow: { dateFormats: ["DD-MON-YY"] },
  pender: { dateFormats: ["epoch ms"] },
  person: { dateFormats: ["MM/DD/YYYY"] },
  pitt: { dateFormats: ["MM/YYYY"] },
  robeson: { dateFormats: ["YYYYMMDD int"] },
  rowan: { dateFormats: ["epoch ms"] },
  rutherford: { dateFormats: ["epoch ms"] },
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
  bladen: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Bladen only exposes year-level sale dates, so it is not approved for a true past-90-day buyer sweep.",
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
  cherokee: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
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
  davidson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Month-level sale timing is acceptable for now and the county is approved for past-90-day sweeps.",
  },
  durham: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Recent successful live runs make Durham approved for operator-facing past-90-day sweeps.",
  },
  gaston: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
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
  lee: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Lee is currently represented by year-specific source rows and is not yet approved as a true past-90-day buyer feed.",
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
  robeson: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Robeson is approved for past-90-day sweeps and is the safest current launch path in the live workflow.",
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
  surry: {
    supportsPast90Days: false,
    verificationStatus: "historical_only",
    verificationReason: "Surry is currently backed by historical yearly parcel layers and is not approved as a true past-90-day buyer feed.",
  },
  wake: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Wake source coverage supports past-90-day sweeps, but the county remains blocked operationally until the timeout patch is deployed.",
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
  yadkin: {
    supportsPast90Days: true,
    verificationStatus: "approved",
    verificationReason: "Current live source is approved for operator-facing past-90-day buyer sweeps.",
  },
};

export const fallbackCountySourceRows: CountySourceRow[] = [
  { county: "Alamance", state: "NC", source_type: "arcgis_alamance", active: true, notes: "apps.alamance-nc.com source is live." },
  { county: "Bladen", state: "NC", source_type: "arcgis_bladen", active: true, notes: "Year-only deed dates." },
  { county: "Buncombe", state: "NC", source_type: "arcgis_buncombe", active: true, notes: "YYYYMMDD string date format." },
  { county: "Cabarrus", state: "NC", source_type: "arcgis_cabarrus", active: true, notes: "Parcel ID uses PIN14." },
  { county: "Cherokee", state: "NC", source_type: "arcgis_cherokee", active: true, notes: "Month and year sale timing." },
  { county: "Craven", state: "NC", source_type: "arcgis_craven", active: true, notes: "SALE_DATE epoch ms." },
  { county: "Cumberland", state: "NC", source_type: "arcgis_cumberland", active: true, notes: "PKG_SALE_DATE ISO string." },
  { county: "Davidson", state: "NC", source_type: "arcgis_davidson", active: true, notes: "SaleMonth1 and SaleYear1 fields." },
  { county: "Durham", state: "NC", source_type: "arcgis_durham", active: true, notes: "PKG_SALE_DATE epoch ms." },
  { county: "Forsyth", state: "NC", source_type: "arcgis_forsyth", active: false, notes: "Public source lacks buyer names." },
  { county: "Gaston", state: "NC", source_type: "arcgis_gaston", active: true, notes: "SALEDATE epoch ms." },
  { county: "Guilford", state: "NC", source_type: "arcgis_guilford", active: true, notes: "PKG_SALE_DATE epoch ms." },
  { county: "Harnett", state: "NC", source_type: "arcgis_harnett", active: true, notes: "SaleMonth and SaleYear fields." },
  { county: "Henderson", state: "NC", source_type: "arcgis_henderson", active: true, notes: "PKG_SALE_DATE epoch ms." },
  { county: "Hoke", state: "NC", source_type: "arcgis_hoke", active: true, notes: "DEED_DATE YYYYMMDD integer." },
  { county: "Iredell", state: "NC", source_type: "arcgis_iredell", active: true, notes: "Historical yearly rows only." },
  { county: "Lee", state: "NC", source_type: "arcgis_lee", active: true, notes: "Historical yearly rows only." },
  { county: "Macon", state: "NC", source_type: "arcgis_macon", active: true, notes: "Historical source range only." },
  { county: "Mecklenburg", state: "NC", source_type: "arcgis_mecklenburg", active: true, notes: "Large paged source." },
  { county: "Moore", state: "NC", source_type: "arcgis_moore", active: true, notes: "RECENT_SALEDT epoch ms." },
  { county: "New Hanover", state: "NC", source_type: "arcgis_newhanover", active: true, notes: "ISO datetime string." },
  { county: "Onslow", state: "NC", source_type: "arcgis_onslow", active: true, notes: "DD-MON-YY date format." },
  { county: "Pender", state: "NC", source_type: "arcgis_pender", active: true, notes: "DATE epoch ms." },
  { county: "Person", state: "NC", source_type: "arcgis_person", active: true, notes: "Sale_Date MM/DD/YYYY." },
  { county: "Pitt", state: "NC", source_type: "arcgis_pitt", active: true, notes: "SalesMonthYear MM/YYYY." },
  { county: "Robeson", state: "NC", source_type: "arcgis", active: true, notes: "ArcGIS parcel layer." },
  { county: "Rowan", state: "NC", source_type: "arcgis_rowan", active: true, notes: "DATESOLD epoch ms." },
  { county: "Rutherford", state: "NC", source_type: "arcgis_rutherford", active: true, notes: "Deed_Date epoch ms." },
  { county: "Surry", state: "NC", source_type: "arcgis_surry", active: true, notes: "Historical yearly rows only." },
  { county: "Wake", state: "NC", source_type: "arcgis_wake", active: true, notes: "SALE_DATE epoch ms." },
  { county: "Warren", state: "NC", source_type: "arcgis_warren", active: true, notes: "DEEDDATE epoch ms." },
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
    recentRuns: "7 recent runs: 3 success, 4 Wake timeout failures",
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
    status: "failed",
    dateRange: "2020-01-01 to 2024-12-31",
    buyersFound: 0,
    salesAnalyzed: 0,
    notes: "Timed out in Pull Sales Data after 60 seconds.",
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
  "Get the Wake county filter patch accepted by the n8n workflow update API, then reopen Wake land searches.",
  "Replace polling with realtime subscriptions once queue behavior settles.",
  "Connect Export, Outreach, and Buyer Summary buttons to the deployed edge functions.",
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

  if (normalizedCounty === "wake" && normalizedPropertyType === "land") {
    return {
      blocked: true,
      reason:
        "Wake County land sweeps are temporarily blocked while the backend county filter patch is waiting on a successful workflow deploy.",
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
      tone: "bad",
      label: "temporarily blocked",
      message:
        "Wake land searches are blocked at intake because the current live workflow still times out on the county source without the backend filter patch.",
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

  if (normalizedCounty === "durham" || normalizedCounty === "guilford") {
    return {
      county,
      tone: "good",
      label: "stable reference",
      message:
        "This county has recent successful runs and is a strong candidate for operator testing and frontend QA.",
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
