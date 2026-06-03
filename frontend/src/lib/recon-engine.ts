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

/* ── SEO industry landing pages (/recon-engine/[industry]) ── */

export type ReconIndustryPage = {
  slug: string;
  industry: string; // must match a value in reconIndustries
  headline: string;
  intro: string;
  pains: string[];
  metaTitle: string;
  metaDescription: string;
};

export const reconIndustryPages: ReconIndustryPage[] = [
  {
    slug: "lawn-care",
    industry: "Lawn Care",
    headline: "Government & Commercial Contracts for Lawn Care Businesses in North Carolina",
    intro:
      "Cities, counties, schools, and HOAs put grounds-maintenance and mowing work out to bid every year. Most local lawn-care operators never see those opportunities. Recon Engine finds them, scores your fit, and tells you exactly how to respond.",
    pains: [
      "Recurring mowing and grounds contracts are awarded to whoever bids — not whoever is best.",
      "Public parks, schools, and facilities need vendors year-round.",
      "Registering once can put you in front of dozens of agencies.",
    ],
    metaTitle: "Lawn Care Government Contracts in NC | Blackspire Recon Engine",
    metaDescription:
      "Find government and commercial lawn-care and grounds-maintenance contracts in North Carolina before your competition. AI-matched opportunities from Blackspire Recon Engine.",
  },
  {
    slug: "cleaning",
    industry: "Cleaning",
    headline: "Janitorial & Commercial Cleaning Contracts in North Carolina",
    intro:
      "Government buildings, schools, and offices need cleaning every single day. These are some of the most reliable recurring contracts available — and Recon Engine surfaces them for you first.",
    pains: [
      "Janitorial contracts are long-term, recurring revenue.",
      "Agencies re-bid cleaning work on predictable cycles.",
      "Set-aside programs favor small and diverse cleaning vendors.",
    ],
    metaTitle: "Janitorial & Cleaning Contracts in NC | Blackspire Recon Engine",
    metaDescription:
      "Discover government and commercial janitorial and cleaning contracts across North Carolina before competitors. AI opportunity intelligence from Blackspire Recon Engine.",
  },
  {
    slug: "construction",
    industry: "Construction",
    headline: "Construction & Trades Bids and RFPs in North Carolina",
    intro:
      "Public construction, renovation, and trades work flows through state and county procurement constantly. Recon Engine tracks the bids, summarizes the requirements, and scores your fit so you can respond fast.",
    pains: [
      "Construction RFPs are buried across dozens of portals.",
      "Deadlines and bonding requirements are easy to miss.",
      "Prime and subcontracting opportunities both exist if you can find them.",
    ],
    metaTitle: "Construction Bids & RFPs in NC | Blackspire Recon Engine",
    metaDescription:
      "Track public construction and trades bids and RFPs across North Carolina. AI-summarized, fit-scored opportunities from Blackspire Recon Engine.",
  },
  {
    slug: "security",
    industry: "Security",
    headline: "Security Services Contracts in North Carolina",
    intro:
      "Government facilities, events, and properties need security vendors. These contracts are recurring and relationship-driven — Recon Engine helps you find and win them before competitors do.",
    pains: [
      "Facility and event security work is awarded on contract.",
      "Agencies prefer vendors already registered and responsive.",
      "Veteran-owned security firms qualify for set-asides.",
    ],
    metaTitle: "Security Services Contracts in NC | Blackspire Recon Engine",
    metaDescription:
      "Find government and commercial security services contracts in North Carolina before your competition with Blackspire Recon Engine.",
  },
  {
    slug: "pressure-washing",
    industry: "Pressure Washing",
    headline: "Pressure Washing & Exterior Cleaning Contracts in North Carolina",
    intro:
      "Sidewalks, fleets, buildings, and public facilities all need exterior cleaning. Recon Engine surfaces the contracts and tells you how to qualify and respond.",
    pains: [
      "Facility and fleet washing is recurring, schedulable revenue.",
      "Most pressure-washing operators never bid on public work.",
      "A single registration can unlock multiple agencies.",
    ],
    metaTitle: "Pressure Washing Contracts in NC | Blackspire Recon Engine",
    metaDescription:
      "Discover government and commercial pressure-washing and exterior-cleaning contracts in North Carolina before competitors with Blackspire Recon Engine.",
  },
  {
    slug: "it-services",
    industry: "IT Services",
    headline: "IT Services & Technology Contracts in North Carolina",
    intro:
      "State and local agencies spend heavily on IT support, managed services, and technology projects. Recon Engine finds the opportunities, decodes the requirements, and scores your fit.",
    pains: [
      "Government IT spend is large and continuous.",
      "Requirements and certifications are hard to parse — AI summaries fix that.",
      "Small and diverse IT vendors qualify for targeted programs.",
    ],
    metaTitle: "IT Services Government Contracts in NC | Blackspire Recon Engine",
    metaDescription:
      "Find government IT services, managed services, and technology contracts across North Carolina before competitors with Blackspire Recon Engine.",
  },
];

export function getReconIndustryPage(slug: string): ReconIndustryPage | undefined {
  return reconIndustryPages.find((page) => page.slug === slug);
}
