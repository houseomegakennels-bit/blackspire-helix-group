export type DealEngineLead = {
  id: string;
  ownerName: string;
  ownerPhone?: string;
  phoneStatus?: string;
  skipTraceStatus?: string;
  phoneSource?: string;
  contactEnrichmentNotes?: string;
  propertyAddress: string;
  county: string;
  status: string;
  motivationScore: number;
  mao: string;
  assignmentFee: string;
  exitStrategy: string;
  nextAction: string;
};

export type DealEngineSellerSignal = {
  id: string;
  ownerName: string;
  ownerPhone?: string;
  phoneStatus?: string;
  skipTraceStatus?: string;
  phoneSource?: string;
  contactEnrichmentNotes?: string;
  propertyAddress: string;
  county: string;
  status: string;
  score: number;
  sourceName: string;
  summary: string;
  recommendedAction: string;
};

export type DealEngineBuyerSignal = {
  id: string;
  buyerName: string;
  mailingAddress: string;
  market: string;
  propertyType: string;
  score: number;
  purchaseCount: number;
  totalSpend: string;
  searchJobId: string;
  outreachSubject: string;
  outreachAngle: string;
};

export type DealEngineContractDraft = {
  dealId: string;
  propertyAddress: string;
  sellerName: string;
  contractType: string;
  offerWindow: string;
  earnestMoney: string;
  outreachLead: string;
  buyerDispositionNote: string;
  nextSteps: string[];
};

export const dealEngineMetrics = [
  {
    label: "Qualified Leads In Command",
    value: "28",
    detail: "Seller Engine handoffs currently waiting on underwriting, outreach, or disposition prep.",
  },
  {
    label: "Offers Ready",
    value: "06",
    detail: "Deals already modeled with target pricing and a recommended negotiation lane.",
  },
  {
    label: "Negotiating",
    value: "04",
    detail: "Live seller conversations active across price, timing, and terms.",
  },
  {
    label: "Projected Assignment Fees",
    value: "$40K",
    detail: "Modeled fee volume across the current flagship opportunity set.",
  },
] as const;

export const dealEngineLeads: DealEngineLead[] = [
  {
    id: "DE-2417",
    ownerName: "Eleanor Shaw",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Deal Engine workflow",
    contactEnrichmentNotes: "No seller phone is stored for this opportunity. Skip trace and verify the best number before first-touch outreach.",
    propertyAddress: "1438 Winding Creek Dr, Charlotte, NC 28214",
    county: "Mecklenburg",
    status: "Offer Ready",
    motivationScore: 91,
    mao: "$195,000",
    assignmentFee: "$18,000",
    exitStrategy: "Wholesale to a mid-volume Charlotte flipper",
    nextAction: "Open the seller conversation with a clean-close convenience angle and confirm all decision-makers.",
  },
  {
    id: "DE-2421",
    ownerName: "Marcus Bell",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Deal Engine workflow",
    contactEnrichmentNotes: "No verified seller phone has been carried into the deal yet.",
    propertyAddress: "509 Gordon Ave, Durham, NC 27701",
    county: "Durham",
    status: "Needs Analysis",
    motivationScore: 78,
    mao: "$233,000",
    assignmentFee: "$22,000",
    exitStrategy: "BRRRR-oriented duplex buyer",
    nextAction: "Tighten rehab scope and position direct-sale certainty versus retail prep cost.",
  },
  {
    id: "DE-2430",
    ownerName: "Terry Cole",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Deal Engine workflow",
    contactEnrichmentNotes: "Phone capture is still open. Treat seller contact enrichment as a required intake step.",
    propertyAddress: "3111 Brookrun Ct, Greensboro, NC 27406",
    county: "Guilford",
    status: "Offer Ready",
    motivationScore: 84,
    mao: "$167,000",
    assignmentFee: "$15,000",
    exitStrategy: "Entry flip package for a local investor list",
    nextAction: "Release AI seller SMS and contract-ready pricing range.",
  },
] as const;

export const dealEngineModules = [
  {
    title: "Deal Analyzer",
    points: [
      "ARV, repairs, spread, rental upside, and MAO workbench logic",
      "Settings-based underwriting model instead of static formulas",
      "Green / yellow / red deal posture for fast triage",
    ],
  },
  {
    title: "Acquisition Agent",
    points: [
      "Cold call, SMS, email, and objection-handling copy generation",
      "Negotiation tracker with next-move suggestions",
      "No auto-sending in MVP, just copy-ready acquisition assets",
    ],
  },
  {
    title: "Disposition Command",
    points: [
      "Buyer-match prep for county, ARV, rehab profile, and exit strategy",
      "Deal packet assembly, investor summary, and buyer alert drafts",
      "Shareable deal room path for buyer-facing review",
    ],
  },
] as const;

export const dealEngineFlow = [
  {
    label: "Seller Engine",
    detail: "Discovers and qualifies motivated sellers with source-level context and motivation scoring.",
    href: "/seller-engine",
  },
  {
    label: "Nexus",
    detail: "Resolves missing owner contact data and verifies the best outreach path before acquisition begins.",
    href: "/workspace/nexus",
  },
  {
    label: "Deal Engine",
    detail: "Underwrites the opportunity, drives acquisition, and shapes the deal for disposition.",
    href: "/workspace/deal-engine",
  },
  {
    label: "Buyer Engine",
    detail: "Activates the investor network with buyer intelligence, exports, and outreach prep.",
    href: "/workspace/buyer-engine",
  },
] as const;

export const dealEngineSellerSignals: DealEngineSellerSignal[] = [
  {
    id: "demo-3",
    ownerName: "Lydia Foster",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Seller Engine",
    contactEnrichmentNotes: "Seller contact data is incomplete. Verify the best number before moving this lead deeper into acquisition.",
    propertyAddress: "2631 Eastway Drive, Charlotte, NC 28205",
    county: "Mecklenburg",
    status: "Contact Ready",
    score: 84,
    sourceName: "Code Violations",
    summary:
      "Seller profile shows absentee ownership, visible vacancy pressure, and enough equity to support a speed-and-certainty offer path.",
    recommendedAction:
      "Move this lead into Deal Engine immediately, validate condition, and frame the direct-sale tradeoff against retail prep.",
  },
  {
    id: "demo-2",
    ownerName: "Darnell Price",
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Seller Engine",
    contactEnrichmentNotes: "No seller phone is attached yet. Queue skip trace before outreach.",
    propertyAddress: "712 Bragg Boulevard, Fayetteville, NC 28301",
    county: "Cumberland",
    status: "Reviewing",
    score: 79,
    sourceName: "Tax Delinquent List",
    summary:
      "Out-of-state owner with tax pressure and code issues suggests a good probability of convenience-led negotiation.",
    recommendedAction:
      "Confirm mortgage posture, position clean close speed, and collect repair detail before anchoring price.",
  },
] as const;

export const dealEngineBuyerSignals: DealEngineBuyerSignal[] = [
  {
    id: "buyer-signal-1",
    buyerName: "Queen City Capital",
    mailingAddress: "1120 East Blvd, Charlotte, NC 28203",
    market: "Mecklenburg, NC",
    propertyType: "Single Family",
    score: 92,
    purchaseCount: 6,
    totalSpend: "$1,980,000",
    searchJobId: "search-mecklenburg-sfr",
    outreachSubject: "Mecklenburg single-family acquisition lane",
    outreachAngle:
      "Reference repeat activity, cash speed, and a clean assignment-ready Charlotte deal profile.",
  },
  {
    id: "buyer-signal-2",
    buyerName: "Bull City Rentals",
    mailingAddress: "410 Mangum St, Durham, NC 27701",
    market: "Durham, NC",
    propertyType: "Duplex",
    score: 84,
    purchaseCount: 4,
    totalSpend: "$1,140,000",
    searchJobId: "search-durham-duplex",
    outreachSubject: "Durham value-add duplex lane",
    outreachAngle:
      "Lead with BRRRR-fit language and highlight stabilized rental upside after renovation.",
  },
] as const;

export const dealEngineContractDrafts: DealEngineContractDraft[] = [
  {
    dealId: "DE-2417",
    propertyAddress: "1438 Winding Creek Dr, Charlotte, NC 28214",
    sellerName: "Eleanor Shaw",
    contractType: "Assignable purchase agreement",
    offerWindow: "$186,000 - $195,000",
    earnestMoney: "$5,000",
    outreachLead:
      "Lead with certainty, as-is close, and a simple family-safe process before anchoring on final pricing.",
    buyerDispositionNote:
      "Pair this with Charlotte flippers already active in Mecklenburg and prep a concise buyer packet immediately after signature.",
    nextSteps: [
      "Make first seller contact and confirm who needs to approve the decision.",
      "Confirm sibling or family decision-maker alignment before papering terms.",
      "Lock inspection and title cadence once the seller is engaged.",
      "Push investor-ready packet once accepted.",
    ],
  },
  {
    dealId: "DE-2421",
    propertyAddress: "509 Gordon Ave, Durham, NC 27701",
    sellerName: "Marcus Bell",
    contractType: "Direct purchase with assignment fallback",
    offerWindow: "$275,000 - $286,000",
    earnestMoney: "$4,000",
    outreachLead:
      "Use a repair-transparency narrative and show the cost of tenant-turn plus listing prep versus direct sale.",
    buyerDispositionNote:
      "Best handed to BRRRR buyers with duplex appetite and strong Durham rental conviction.",
    nextSteps: [
      "Tighten final rehab scope.",
      "Update MAO before papering terms.",
      "Draft buyer-facing summary in parallel.",
    ],
  },
] as const;
