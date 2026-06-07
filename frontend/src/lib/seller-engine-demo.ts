import { calculateSellerLeadScore, recommendedSellerAction, type SellerLeadStatus } from "@/lib/seller-engine";

export type SellerLeadView = {
  id: string;
  ownerName: string;
  ownerMailingAddress: string;
  ownerPhone?: string;
  ownerEmail?: string;
  phoneStatus?: string;
  skipTraceStatus?: string;
  phoneSource?: string;
  contactEnrichmentNotes?: string;
  contactConfidenceScore?: number;
  dncFlag?: boolean | null;
  rawSkiptraceResponse?: Record<string, unknown>;
  propertyAddress: string;
  parcelId: string;
  county: string;
  city: string;
  state?: string;
  zipCode: string;
  propertyType: string;
  assessedValue: number;
  estimatedEquity: number;
  yearsOwned: number;
  status: SellerLeadStatus;
  score: number;
  category: string;
  reasons: string[];
  sourceName: string;
  sourceType?: string;
  sourceIntegrationType?: string;
  ownerOccupancyStatus?: string;
  importedAt: string;
  recommendedAction: string;
  summary: string;
  notes?: Array<{ id: string; note: string; createdAt: string }>;
  statusHistory?: Array<{ id: string; fromStatus: string | null; toStatus: string; createdAt: string }>;
  relatedDealId?: string | null;
  signals: {
    absenteeOwner: boolean;
    taxDelinquent: boolean;
    foreclosure: boolean;
    probate: boolean;
    vacant: boolean;
    codeViolation: boolean;
  };
};

const seeds = [
  {
    id: "demo-1",
    ownerName: "Marion Ellis Estate",
    ownerMailingAddress: "PO Box 814, Richmond, VA 23218",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Public record import",
    contactEnrichmentNotes: "No phone captured from probate import. Pull skip-trace before first outreach.",
    propertyAddress: "1809 Alder Street, Winston-Salem, NC 27105",
    parcelId: "6836-42-2190",
    county: "Forsyth",
    city: "Winston-Salem",
    zipCode: "27105",
    propertyType: "Single Family",
    assessedValue: 168000,
    estimatedEquity: 141000,
    yearsOwned: 22,
    status: "New" as const,
    sourceName: "Probate List",
    sourceType: "probate",
    ownerOccupancyStatus: "Absentee",
    signals: { absenteeOwner: true, taxDelinquent: false, foreclosure: false, probate: true, vacant: true, codeViolation: false },
  },
  {
    id: "demo-2",
    ownerName: "Darnell Price",
    ownerMailingAddress: "54 Pelham Drive, Columbia, SC 29209",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Public record import",
    contactEnrichmentNotes: "Tax-delinquent import did not include a verified phone. Queue contact enrichment.",
    propertyAddress: "712 Bragg Boulevard, Fayetteville, NC 28301",
    parcelId: "0437-88-1021",
    county: "Cumberland",
    city: "Fayetteville",
    zipCode: "28301",
    propertyType: "Duplex",
    assessedValue: 214000,
    estimatedEquity: 122000,
    yearsOwned: 13,
    status: "Reviewing" as const,
    sourceName: "Tax Delinquent List",
    sourceType: "tax_delinquent",
    ownerOccupancyStatus: "Absentee",
    signals: { absenteeOwner: true, taxDelinquent: true, foreclosure: false, probate: false, vacant: false, codeViolation: true },
  },
  {
    id: "demo-3",
    ownerName: "Lydia Foster",
    ownerMailingAddress: "914 Pinecroft Road, Greensboro, NC 27407",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Public record import",
    contactEnrichmentNotes: "No direct number is attached yet. Verify best mobile before first-touch outreach.",
    propertyAddress: "2631 Eastway Drive, Charlotte, NC 28205",
    parcelId: "101-334-18",
    county: "Mecklenburg",
    city: "Charlotte",
    zipCode: "28205",
    propertyType: "Single Family",
    assessedValue: 326000,
    estimatedEquity: 228000,
    yearsOwned: 17,
    status: "Contact Ready" as const,
    sourceName: "Code Violations",
    sourceType: "code_violation",
    ownerOccupancyStatus: "Absentee",
    signals: { absenteeOwner: true, taxDelinquent: false, foreclosure: false, probate: false, vacant: true, codeViolation: true },
  },
  {
    id: "demo-4",
    ownerName: "Cedar Ridge Holdings LLC",
    ownerMailingAddress: "208 Harbor Way, Wilmington, DE 19801",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Public record import",
    contactEnrichmentNotes: "Entity owner requires skip trace or LLC contact research before outreach.",
    propertyAddress: "4400 New Bern Avenue, Raleigh, NC 27610",
    parcelId: "1723-91-6554",
    county: "Wake",
    city: "Raleigh",
    zipCode: "27610",
    propertyType: "Small Multifamily",
    assessedValue: 518000,
    estimatedEquity: 281000,
    yearsOwned: 11,
    status: "Watchlist" as const,
    sourceName: "Absentee Owner List",
    sourceType: "absentee_owner",
    ownerOccupancyStatus: "Absentee",
    signals: { absenteeOwner: true, taxDelinquent: false, foreclosure: false, probate: false, vacant: false, codeViolation: false },
  },
];

export const DEMO_SELLER_LEADS: SellerLeadView[] = seeds.map((lead, index) => {
  const result = calculateSellerLeadScore({
    ...lead.signals,
    yearsOwned: lead.yearsOwned,
    assessedValue: lead.assessedValue,
    estimatedEquity: lead.estimatedEquity,
    outOfStateOwner: index !== 2,
    multipleProperties: index === 3,
  });
  const recommendedAction = recommendedSellerAction(result.score, result.reasons);
  return {
    ...lead,
    score: result.score,
    category: result.category,
    reasons: result.reasons,
    importedAt: new Date(Date.now() - index * 86400000 * 2).toISOString(),
    recommendedAction,
    summary: `${lead.ownerName} shows ${result.reasons.length} motivation signals tied to ${lead.propertyAddress}. The strongest indicators are ${result.reasons.slice(0, 3).join(", ").toLowerCase()}.`,
    notes: [],
    statusHistory: [],
    relatedDealId: null,
  };
});

