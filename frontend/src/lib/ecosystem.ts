export type EcosystemProject = {
  slug: string;
  name: string;
  role: string;
  tagline: string;
  description: string;
  accent: string;
  glow: string;
  cta: string;
  href: string;
  status: "live" | "building";
  targetUser: string;
  primaryOutcome: string;
  featureBullets: string[];
  productHref?: string;
  logoSrc?: string;
  monogram: string;
  motif: string;
  vibe: string;
  surfaceTint: string;
  edgeTint: string;
  iconCue: string;
  logoMaxWidthClass?: string;
  logoMaxHeightClass?: string;
  logoStageClass?: string;
};

export const ecosystemProjects: EcosystemProject[] = [
  {
    slug: "buyer-engine",
    name: "Blackspire Buyer Engine",
    role: "Real Estate Intelligence",
    tagline: "Real Estate Intelligence. Data that Finds Buyers.",
    description:
      "Buyer intelligence workflows for wholesalers and investors, with search-job dispatch, buyer reports, exports, and outreach prep already live in the repo.",
    accent: "#FF8A00",
    glow: "rgba(255, 138, 0, 0.35)",
    cta: "Explore Buyer Engine",
    href: "/ecosystem/buyer-engine",
    productHref: "/workspace/buyer-engine",
    status: "live",
    targetUser: "Wholesalers and investors",
    primaryOutcome: "Find, rank, and activate buyers faster.",
    logoSrc: "/brand/blackspire-buyer-engine-logo-fit.png",
    monogram: "BBE",
    motif: "Targeting reticles, county signal maps, and intelligence rings.",
    vibe: "Precise, luminous, and tactical.",
    surfaceTint: "rgba(255, 138, 0, 0.12)",
    edgeTint: "rgba(255, 193, 99, 0.42)",
    iconCue: "Buyer intelligence",
    logoMaxWidthClass: "max-w-[284px]",
    logoMaxHeightClass: "max-h-[142px]",
    logoStageClass: "h-[132px]",
    featureBullets: [
      "County-aware buyer discovery workflows",
      "Live buyer dossier rendering",
      "Export logging and outreach draft support",
    ],
  },
  {
    slug: "helix-lawn-command",
    name: "Helix Lawn Command",
    role: "Lawn Business Automation",
    tagline:
      "AI-Powered Websites, Branding & Automation for Lawn Care & Landscaping Businesses.",
    description:
      "A service-business operating system for local lawn and landscaping teams that need faster lead capture, smarter follow-up, and cleaner sales flow.",
    accent: "#63D11F",
    glow: "rgba(99, 209, 31, 0.34)",
    cta: "Automate My Lawn Business",
    href: "/ecosystem/helix-lawn-command",
    productHref: "/workspace/helix-lawn-command",
    status: "live",
    targetUser: "Lawn and landscaping companies",
    primaryOutcome: "Capture, qualify, and convert local leads automatically.",
    logoSrc: "/brand/helix-lawn-command-logo-fit.png",
    monogram: "HLC",
    motif: "Route lines, service-radius scans, and local growth signals.",
    vibe: "Fast, local, and conversion-oriented.",
    surfaceTint: "rgba(99, 209, 31, 0.12)",
    edgeTint: "rgba(155, 255, 94, 0.42)",
    iconCue: "Service territory",
    logoMaxWidthClass: "max-w-[210px]",
    logoMaxHeightClass: "max-h-[154px]",
    logoStageClass: "h-[154px]",
    featureBullets: [
      "Website + quote-request automation",
      "SMS follow-up and local lead routing",
      "Branding and CRM workflow support",
    ],
  },
  {
    slug: "social-os",
    name: "Blackspire Social OS",
    role: "Content Automation OS",
    tagline: "AI-Powered Content Creation that Captures Attention.",
    description:
      "A repeatable short-form content system for creators and brands that need prompt discipline, production velocity, and platform-specific output.",
    accent: "#9B5CFF",
    glow: "rgba(155, 92, 255, 0.34)",
    cta: "Build My Content OS",
    href: "/ecosystem/social-os",
    status: "building",
    targetUser: "Creators and local brands",
    primaryOutcome: "Create and manage short-form content consistently.",
    logoSrc: "/brand/blackspire-social-os-logo-fit.png",
    monogram: "BSO",
    motif: "Signal waves, media frames, and distribution rails.",
    vibe: "High-output, creative, and attention-engineered.",
    surfaceTint: "rgba(155, 92, 255, 0.12)",
    edgeTint: "rgba(113, 179, 255, 0.42)",
    iconCue: "Content signal",
    logoMaxWidthClass: "max-w-[286px]",
    logoMaxHeightClass: "max-h-[134px]",
    logoStageClass: "h-[132px]",
    featureBullets: [
      "Reels, captions, and hashtag workflows",
      "Prompt packs and content planning systems",
      "Reusable media operating procedures",
    ],
  },
  {
    slug: "ember-halo",
    name: "Ember Halo",
    role: "Luxury Concierge Commerce",
    tagline: "Discreet Luxury. Elevated Experiences.",
    description:
      "A premium concierge commerce concept with AI-assisted ordering, messaging, and fulfillment layers designed around a polished luxury experience.",
    accent: "#FF3B1F",
    glow: "rgba(255, 59, 31, 0.34)",
    cta: "View Concierge Concept",
    href: "/ecosystem/ember-halo",
    status: "building",
    targetUser: "Premium gift buyers",
    primaryOutcome: "Deliver luxury concierge experiences with elegant automation.",
    logoSrc: "/brand/ember-halo-logo-fit.png",
    monogram: "EH",
    motif: "Halo rings, luxury seals, and ember-lit concierge cues.",
    vibe: "Discreet, elevated, and premium-warm.",
    surfaceTint: "rgba(255, 90, 31, 0.12)",
    edgeTint: "rgba(231, 201, 162, 0.36)",
    iconCue: "Concierge halo",
    logoMaxWidthClass: "max-w-[148px]",
    logoMaxHeightClass: "max-h-[168px]",
    logoStageClass: "h-[168px]",
    featureBullets: [
      "AI concierge interaction flow",
      "Payments and SMS updates",
      "Luxury product and package orchestration",
    ],
  },
  {
    slug: "oracle-helix",
    name: "Oracle Helix",
    role: "Sports Intelligence OS",
    tagline: "Powered by BLACKSPIRE HELIX GROUP.",
    description:
      "A sports intelligence system for analysts and researchers with market tracking, dashboards, and war-room style decision surfaces already forming in the repo.",
    accent: "#4C7DFF",
    glow: "rgba(76, 125, 255, 0.34)",
    cta: "View Intelligence OS",
    href: "/ecosystem/oracle-helix",
    status: "building",
    targetUser: "Researchers and analysts",
    primaryOutcome: "Track sports markets, signals, and intelligence faster.",
    logoSrc: "/brand/oracle-helix-logo-fit.png",
    monogram: "OH",
    motif: "Chart grids, tracking beams, and war-room overlays.",
    vibe: "Analytical, predictive, and war-room ready.",
    surfaceTint: "rgba(76, 125, 255, 0.12)",
    edgeTint: "rgba(185, 196, 216, 0.38)",
    iconCue: "Signal tracking",
    logoMaxWidthClass: "max-w-[246px]",
    logoMaxHeightClass: "max-h-[154px]",
    logoStageClass: "h-[154px]",
    featureBullets: [
      "Sports research and alert surfaces",
      "Market intelligence dashboards",
      "War-room style navigation patterns",
    ],
  },
];

export const parentBrand = {
  name: "BLACKSPIRE HELIX GROUP",
  tagline: "Building AI Employees for Modern Businesses",
  description:
    "AI automation and digital infrastructure for modern businesses that want more leads, faster follow-up, and cleaner operations without adding more manual complexity.",
};

export const serviceLines = [
  "AI employees for lead capture, follow-up, qualification, and internal routing",
  "Workflow automations connecting forms, CRMs, dashboards, SMS, email, and ops tools",
  "Industry-specific operating systems for real estate, lawn care, creators, concierge commerce, and sports intelligence",
  "Custom command surfaces, reports, and dashboards that make automation usable for real operators",
] as const;

export const useCases = [
  "Lead capture and instant qualification",
  "SMS and email follow-up sequences",
  "Buyer matching and investor outreach prep",
  "Content planning and short-form production systems",
  "Concierge communication and luxury order handling",
  "Research alerts, dashboards, and market intelligence routing",
] as const;

export const industries = [
  {
    name: "Real Estate",
    summary: "Buyer discovery, property intelligence, and investor workflow support.",
  },
  {
    name: "Lawn Care and Local Services",
    summary: "Quote intake, fast follow-up, local lead conversion, and operating systems.",
  },
  {
    name: "Creators and Personal Brands",
    summary: "Content pipelines, visual systems, and social execution support.",
  },
  {
    name: "Luxury Commerce",
    summary: "Concierge-style communication, packages, payments, and client experience.",
  },
  {
    name: "Sports Intelligence",
    summary: "Research dashboards, alerting, market context, and signal organization.",
  },
] as const;

export function getProjectBySlug(slug: string) {
  return ecosystemProjects.find((project) => project.slug === slug);
}
