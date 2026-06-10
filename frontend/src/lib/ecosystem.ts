import { brandAssets } from "@/lib/brand-assets";

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
    slug: "recon-engine",
    name: "Blackspire Recon Engine",
    role: "Opportunity Intelligence",
    tagline: "Opportunity Intelligence Before the Competition.",
    description:
      "AI-powered opportunity intelligence that discovers government contracts, grants, vendor programs, and revenue opportunities before your competition — then fit-scores and matches them to your business.",
    accent: "#D4AF37",
    glow: "rgba(139, 92, 246, 0.34)",
    cta: "Explore Recon Engine",
    href: "/recon-engine",
    status: "live",
    targetUser: "Service businesses chasing contracts",
    primaryOutcome: "Find contracts, grants, and vendor programs before competitors.",
    logoSrc: "/brand/blackspire-recon-engine-logo.png",
    monogram: "BRE",
    motif: "Radar sweeps, targeting reticles, and opportunity signal pings.",
    vibe: "Strategic, predictive, and first-to-market.",
    surfaceTint: "rgba(212, 175, 55, 0.12)",
    edgeTint: "rgba(139, 92, 246, 0.40)",
    iconCue: "Opportunity radar",
    logoMaxWidthClass: "max-w-[200px]",
    logoMaxHeightClass: "max-h-[150px]",
    featureBullets: [
      "AI scans contracts, grants, and vendor programs",
      "Fit-scored matches to your business and geography",
      "Deadline tracking plus AI proposal and capability drafts",
    ],
  },
  {
    slug: "harvester",
    name: "Blackspire Harvester",
    role: "Opportunity Acquisition Intelligence",
    tagline: "Extract. Analyze. Acquire.",
    description:
      "Harvester is the intake and market-intelligence layer for Blackspire real estate operations, turning screenshots, pasted posts, flyers, PDFs, emails, SMS, and marketplace chatter into structured opportunities that feed the rest of the ecosystem.",
    accent: "#D6A84F",
    glow: "rgba(214, 168, 79, 0.34)",
    cta: "Open Harvester",
    href: "/ecosystem/harvester",
    productHref: "/workspace/harvester",
    status: "live",
    targetUser: "Acquisitions operators and marketplace researchers",
    primaryOutcome: "Convert unstructured opportunity chatter into structured, pipeline-ready deal records.",
    logoSrc: brandAssets.harvester.logo,
    monogram: "BHV",
    motif: "Helix-wrapped stalks, extraction scan fields, and marketplace signal sweeps.",
    vibe: "Cinematic, forensic, and acquisition-first.",
    surfaceTint: "rgba(214, 168, 79, 0.12)",
    edgeTint: "rgba(191, 196, 201, 0.32)",
    iconCue: "Opportunity harvest",
    logoMaxWidthClass: "max-w-[248px]",
    logoMaxHeightClass: "max-h-[182px]",
    logoStageClass: "h-[174px]",
    featureBullets: [
      "Capture opportunity data from text, screenshots, flyers, and PDFs",
      "Extract structured property and poster intelligence with confidence tracking",
      "Hand approved records into Seller, Nexus, Deal, and Buyer workflows",
    ],
  },
  {
    slug: "buyer-engine",
    name: "Blackspire Buyer Engine",
    role: "Real Estate Intelligence",
    tagline: "Real Estate Intelligence. Data that Finds Buyers.",
    description:
      "Buyer intelligence workflows for wholesalers and investors, with search-job dispatch, buyer reports, exports, and outreach prep already live in the repo.",
    accent: "#FF9A1F",
    glow: "rgba(255, 154, 31, 0.35)",
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
    surfaceTint: "rgba(255, 154, 31, 0.12)",
    edgeTint: "rgba(216, 184, 90, 0.42)",
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
    slug: "seller-engine",
    name: "Blackspire Seller Engine",
    role: "Motivated Seller Intelligence",
    tagline: "Find the Pressure. Qualify the Seller.",
    description:
      "A motivated-seller discovery and intelligence system for wholesalers and investors, combining public-record imports, transparent motivation scoring, seller dossiers, alerts, and clean Deal Engine handoff.",
    accent: "#E33A32",
    glow: "rgba(227, 58, 50, 0.34)",
    cta: "Open Seller Engine",
    href: "/ecosystem/seller-engine",
    productHref: "/seller-engine",
    status: "live",
    targetUser: "Wholesalers and acquisitions teams",
    primaryOutcome: "Find, score, and organize motivated seller leads.",
    logoSrc: brandAssets.sellerEngine.logo,
    monogram: "BSE",
    motif: "Distress signal maps, parcel intelligence, and motivation score rings.",
    vibe: "Discreet, forensic, and acquisition-ready.",
    surfaceTint: "rgba(227, 58, 50, 0.12)",
    edgeTint: "rgba(198, 205, 214, 0.38)",
    iconCue: "Seller intelligence",
    logoMaxWidthClass: "max-w-[252px]",
    logoMaxHeightClass: "max-h-[236px]",
    logoStageClass: "h-[208px]",
    featureBullets: [
      "Public-record CSV harvesting and source registry",
      "Transparent adjustable motivation scoring",
      "Seller dossiers, alerts, and Deal Engine handoff",
    ],
  },
  {
    slug: "deal-engine",
    name: "Blackspire Deal Engine",
    role: "Wholesale Deal Command",
    tagline: "Analyze. Acquire. Match. Close.",
    description:
      "The acquisition and disposition operating layer that receives qualified seller leads, underwrites MAO and spread, coordinates seller outreach, tracks contracts, prepares buyer handoff, and packages deals for close.",
    accent: "#3FB6C9",
    glow: "rgba(63, 182, 201, 0.34)",
    cta: "Open Deal Engine",
    href: "/ecosystem/deal-engine",
    productHref: "/workspace/deal-engine",
    status: "live",
    targetUser: "Acquisitions managers, analysts, and dispositions teams",
    primaryOutcome: "Turn qualified seller leads into disposition-ready wholesale opportunities.",
    logoSrc: brandAssets.dealEngine.logo,
    monogram: "BDE",
    motif: "Deal packet vaults, MAO workbenches, and acquisition-to-buyer relay lines.",
    vibe: "Luxury tactical, financial, and close-oriented.",
    surfaceTint: "rgba(63, 182, 201, 0.12)",
    edgeTint: "rgba(201, 162, 63, 0.42)",
    iconCue: "Deal command",
    logoMaxWidthClass: "max-w-[248px]",
    logoMaxHeightClass: "max-h-[248px]",
    logoStageClass: "h-[188px]",
    featureBullets: [
      "MAO, spread, and exit-strategy underwriting",
      "AI-assisted seller acquisition scripts and negotiation tracking",
      "Buyer handoff prep, deal packets, and disposition workflow",
    ],
  },
  {
    slug: "nexus",
    name: "Blackspire Nexus",
    role: "Contact Resolution Command",
    tagline: "Find the Decision Maker.",
    description:
      "The contact intelligence layer between Seller Engine and Deal Engine. Nexus runs skip trace, resolves the right decision maker, scores contact confidence, and hands verified outreach data back into the real estate pipeline.",
    accent: "#8B5CF6",
    glow: "rgba(139, 92, 246, 0.34)",
    cta: "Open Nexus",
    href: "/ecosystem/nexus",
    productHref: "/workspace/nexus",
    status: "live",
    targetUser: "Acquisitions coordinators and contact-enrichment operators",
    primaryOutcome: "Turn unidentified seller contact posture into verified outreach-ready records.",
    logoSrc: brandAssets.nexus.logo,
    monogram: "BNX",
    motif: "Identity resolution grids, tracing paths, and contact-confidence relays.",
    vibe: "Forensic, precise, and pipeline-critical.",
    surfaceTint: "rgba(139, 92, 246, 0.12)",
    edgeTint: "rgba(180, 214, 220, 0.38)",
    iconCue: "Contact resolution",
    logoMaxWidthClass: "max-w-[236px]",
    logoMaxHeightClass: "max-h-[236px]",
    logoStageClass: "h-[188px]",
    featureBullets: [
      "Queue seller and deal records missing verified phone data",
      "Run skip trace, verify the best number, and log contact posture",
      "Feed verified outreach paths back into Seller Engine and Deal Engine",
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
    href: "/helix-lawn-command",
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
    accent: "#9D63FF",
    glow: "rgba(157, 99, 255, 0.34)",
    cta: "Build My Content OS",
    href: "/ecosystem/social-os",
    status: "building",
    targetUser: "Creators and local brands",
    primaryOutcome: "Create and manage short-form content consistently.",
    logoSrc: "/brand/blackspire-social-os-logo-fit.png",
    monogram: "BSO",
    motif: "Signal waves, media frames, and distribution rails.",
    vibe: "High-output, creative, and attention-engineered.",
    surfaceTint: "rgba(157, 99, 255, 0.12)",
    edgeTint: "rgba(82, 148, 255, 0.42)",
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
    accent: "#F08A22",
    glow: "rgba(240, 138, 34, 0.34)",
    cta: "View Concierge Concept",
    href: "/ecosystem/ember-halo",
    status: "building",
    targetUser: "Premium gift buyers",
    primaryOutcome: "Deliver luxury concierge experiences with elegant automation.",
    logoSrc: "/brand/ember-halo-logo-fit.png",
    monogram: "EH",
    motif: "Halo rings, luxury seals, and ember-lit concierge cues.",
    vibe: "Discreet, elevated, and premium-warm.",
    surfaceTint: "rgba(240, 138, 34, 0.12)",
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
    accent: "#44A8FF",
    glow: "rgba(68, 168, 255, 0.34)",
    cta: "View Intelligence OS",
    href: "/ecosystem/oracle-helix",
    status: "building",
    targetUser: "Researchers and analysts",
    primaryOutcome: "Track sports markets, signals, and intelligence faster.",
    logoSrc: "/brand/oracle-helix-logo-fit.png",
    monogram: "OH",
    motif: "Chart grids, tracking beams, and war-room overlays.",
    vibe: "Analytical, predictive, and war-room ready.",
    surfaceTint: "rgba(68, 168, 255, 0.12)",
    edgeTint: "rgba(162, 92, 255, 0.40)",
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
  "Opportunity intake from marketplace posts, screenshots, and unstructured deal chatter",
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
