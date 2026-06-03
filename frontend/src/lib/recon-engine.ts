/**
 * Blackspire Recon Engine — opportunity intelligence division.
 * Phase 1: brand, landing copy, pricing, and the Free Opportunity Scan
 * lead-magnet types + a plain-English snapshot generator. No external data
 * sources or billing wired yet (later phases).
 */

export const reconEngineBrand = {
  name: "Blackspire Recon Engine",
  tagline: "Opportunity Intelligence Before the Competition",
  route: "/recon-engine",
  logo: "/brand/blackspire-recon-engine-logo.png",
} as const;

/** The 5 pillars from the official logo art. */
export const reconPillars = [
  {
    key: "discover",
    title: "Discover",
    icon: "🔍",
    copy: "Uncover hidden opportunities across markets, properties, and off-market channels.",
  },
  {
    key: "ai-powered",
    title: "AI Powered",
    icon: "🧠",
    copy: "Advanced AI scans millions of data points to identify high-potential leads and trends.",
  },
  {
    key: "precision",
    title: "Precision",
    icon: "🎯",
    copy: "Pinpoint the right opportunities with real-time intelligence and predictive insights.",
  },
  {
    key: "strategic",
    title: "Strategic",
    icon: "🛡️",
    copy: "Strategic advantage through accurate data, deeper visibility, and smarter decisions.",
  },
  {
    key: "revenue",
    title: "Revenue",
    icon: "📈",
    copy: "Close more deals faster by acting on opportunities before the competition.",
  },
] as const;

export type ReconPlan = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  highlighted?: boolean;
  billingModel: "subscription" | "payg";
};

export const reconPlans: ReconPlan[] = [
  {
    id: "scout",
    name: "Scout",
    price: "$30",
    cadence: "/month",
    tagline: "Start tracking opportunities.",
    billingModel: "subscription",
    features: [
      "3 qualified opportunities monthly",
      "AI summaries",
      "Email alerts",
      "Opportunity tracking",
      "Basic dashboard",
    ],
  },
  {
    id: "operator",
    name: "Operator",
    price: "$60",
    cadence: "/month",
    tagline: "Match and prioritize at scale.",
    billingModel: "subscription",
    highlighted: true,
    features: [
      "10 qualified opportunities monthly",
      "AI summaries",
      "AI fit scoring",
      "Saved opportunities",
      "Deadline tracking",
      "Recommendations",
    ],
  },
  {
    id: "commander",
    name: "Commander",
    price: "$100",
    cadence: "/month",
    tagline: "Full command of the pipeline.",
    billingModel: "subscription",
    features: [
      "Unlimited opportunities",
      "AI summaries + fit scoring",
      "Proposal Draft Generator",
      "Capability Statement Generator",
      "Priority alerts",
      "Advanced matching",
      "Full dashboard",
    ],
  },
  {
    id: "payg",
    name: "Pay-As-You-Go",
    price: "$30",
    cadence: "/opportunity",
    tagline: "No subscription. Unlock what you want.",
    billingModel: "payg",
    features: [
      "Unlock any single opportunity",
      "Full opportunity report",
      "AI summary + requirements",
      "No monthly commitment",
    ],
  },
];

/** Launch-focus industries for the Free Opportunity Scan. */
export const reconIndustries = [
  "Landscaping",
  "Lawn Care",
  "Cleaning",
  "Janitorial",
  "Pressure Washing",
  "Construction",
  "Security",
  "IT Services",
  "Transportation",
  "Maintenance",
  "Property Services",
] as const;

export type LeadScanInput = {
  name: string;
  companyName: string;
  email: string;
  industry: string;
  services: string;
  county: string;
  state: string;
};

export function normalizeLeadScanInput(
  input: Partial<LeadScanInput> | null | undefined,
): LeadScanInput {
  return {
    name: input?.name?.trim() ?? "",
    companyName: input?.companyName?.trim() ?? "",
    email: input?.email?.trim() ?? "",
    industry: input?.industry?.trim() ?? "",
    services: input?.services?.trim() ?? "",
    county: input?.county?.trim() ?? "",
    state: input?.state?.trim() ?? "",
  };
}

/**
 * Plain-English Opportunity Snapshot. Advisory, not fabricated figures — it
 * frames the opportunity landscape and concrete next steps for the lead's
 * industry + geography. A later phase can swap this for an AI-generated report.
 */
export function buildOpportunitySnapshot(input: LeadScanInput): string {
  const company = input.companyName || "your business";
  const industry = input.industry || "your industry";
  const place =
    input.county && input.state
      ? `${input.county}, ${input.state}`
      : input.state || "your area";

  const programs = [
    "Local & county government contracts (parks, facilities, public works)",
    "State procurement portals and vendor registration",
    "Federal contracting via SAM.gov set-asides",
    "Supplier diversity, minority-owned, and veteran-owned business programs",
    "Grants and RFPs tied to your service categories",
  ];

  return [
    `OPPORTUNITY SNAPSHOT — ${company}`,
    "",
    `Industry: ${industry}`,
    `Target market: ${place}`,
    input.services ? `Services: ${input.services}` : "",
    "",
    `Based on your profile, ${company} is positioned to compete for recurring, ` +
      `contract-based revenue in ${place}. Businesses in ${industry} are frequently ` +
      `underrepresented in public bidding — which means less competition for operators ` +
      `who register and respond first.`,
    "",
    "Opportunity channels to track:",
    ...programs.map((p) => ` • ${p}`),
    "",
    "Recommended next steps:",
    " 1. Make sure your business is registered with the relevant procurement portals.",
    " 2. Prepare a capability statement so you can respond to bids fast.",
    " 3. Set deadline alerts so you never miss a closing date.",
    " 4. Let Recon Engine fit-score and rank incoming opportunities for you automatically.",
    "",
    "This is a preview. Start tracking with Recon Engine to get live, fit-scored " +
      "opportunities matched to your business before your competitors see them.",
  ]
    .filter(Boolean)
    .join("\n");
}
