export type SiteNavItem = {
  label: string;
  href: string;
  description?: string;
};

export type SiteNavSection = {
  label: string;
  href?: string;
  items: SiteNavItem[];
};

export type WorkspaceEntry = {
  title: string;
  href: string;
  division: string;
  status: "Live" | "Admin" | "Public" | "Building";
  description: string;
  primaryAction: string;
};

export const siteNavSections: SiteNavSection[] = [
  {
    label: "Overview",
    href: "/",
    items: [
      { label: "Home", href: "/", description: "Parent company command page." },
      { label: "Ecosystem", href: "/ecosystem", description: "Every Blackspire division in one view." },
      { label: "Workspaces", href: "/workspaces", description: "Operator surfaces and internal tools." },
    ],
  },
  {
    label: "Real Estate",
    href: "/real-estate-intelligence",
    items: [
      { label: "Real Estate Intelligence", href: "/real-estate-intelligence", description: "Seller to buyer pipeline." },
      { label: "Sentinel", href: "/workspace/sentinel", description: "Command intelligence layer across the entire pipeline." },
      { label: "Properties", href: "/workspace/property", description: "Unified property command — every record in one view." },
      { label: "Harvester", href: "/workspace/harvester", description: "Opportunity intake and marketplace intelligence." },
      { label: "Seller Engine", href: "/workspace/seller-engine", description: "Motivated seller discovery." },
      { label: "Nexus", href: "/workspace/nexus", description: "Skip trace and contact resolution." },
      { label: "Deal Engine", href: "/workspace/deal-engine", description: "Acquisition, contracts, packets, and close coordination." },
      { label: "Buyer Engine", href: "/workspace/buyer-engine", description: "Buyer matching and outreach." },
      { label: "Buyer Reverse Search", href: "/workspace/buyer-engine/reverse-search", description: "Reverse-match buyer criteria into seller and deal opportunities." },
    ],
  },
  {
    label: "Products",
    href: "/services",
    items: [
      { label: "Recon Engine", href: "/recon-engine", description: "Opportunity intelligence." },
      { label: "Helix Lawn Command", href: "/helix-lawn-command", description: "Local service automation." },
      { label: "Social OS", href: "/social-os", description: "Protected client content workflows." },
      { label: "Demos", href: "/demos", description: "Proof surfaces and examples." },
      { label: "Services", href: "/services", description: "What Blackspire builds." },
      { label: "Industries", href: "/industries", description: "Where the systems apply." },
    ],
  },
  {
    label: "Company",
    href: "/about",
    items: [
      { label: "About", href: "/about", description: "Blackspire thesis and positioning." },
      { label: "Contact", href: "/contact", description: "Start a project or request access." },
    ],
  },
];

export const workspaceEntries: WorkspaceEntry[] = [
  {
    title: "Sentinel",
    href: "/workspace/sentinel",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "The executive command layer: morning brief, deal readiness scores, follow-up queue, opportunity feed, and a unified inbox across every engine.",
    primaryAction: "Open command center",
  },
  {
    title: "Property Command",
    href: "/workspace/property",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "The single source-of-truth property view: seller, deal, buyers, contract, transaction, scores, timeline, and next best action in one place.",
    primaryAction: "Open property command",
  },
  {
    title: "Harvester",
    href: "/workspace/harvester",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "Capture screenshots, pasted posts, flyers, PDFs, and raw marketplace chatter, then extract structured opportunities and push them into the pipeline.",
    primaryAction: "Open intake command",
  },
  {
    title: "Seller Engine",
    href: "/workspace/seller-engine",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "Import public-record leads, score seller motivation, review source health, and prepare contact enrichment.",
    primaryAction: "Open seller queue",
  },
  {
    title: "Nexus",
    href: "/workspace/nexus",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "Run Tracerfy-powered skip trace, resolve the right decision maker, and score contact confidence.",
    primaryAction: "Open contact command",
  },
  {
    title: "Deal Engine",
    href: "/workspace/deal-engine",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "Underwrite deals, draft contract posture, build buyer packets, manage investor rooms, and coordinate close.",
    primaryAction: "Open deal command",
  },
  {
    title: "Buyer Engine",
    href: "/workspace/buyer-engine",
    division: "Real Estate Intelligence",
    status: "Live",
    description: "Search buyer records, reverse-match buy boxes into live opportunities, build investor reports, export targets, and generate outreach drafts.",
    primaryAction: "Open buyer command",
  },
  {
    title: "Recon Engine",
    href: "/recon-engine/dashboard",
    division: "Opportunity Intelligence",
    status: "Live",
    description: "Monitor contracts, grants, vendor programs, and opportunity scans for service businesses.",
    primaryAction: "Open recon dashboard",
  },
  {
    title: "Helix Lawn Command",
    href: "/workspace/helix-lawn-command",
    division: "Local Service Automation",
    status: "Live",
    description: "Review lawn-care lead intake, AI photo analysis, and local service workflow posture.",
    primaryAction: "Open lawn command",
  },
  {
    title: "Social OS",
    href: "/social-os",
    division: "Client Workspaces",
    status: "Live",
    description: "Protected client content operations with reusable media, platform-specific edits, approval gates, retries, and audit logs.",
    primaryAction: "Open client workspace",
  },
  {
    title: "Admin Console",
    href: "/admin",
    division: "Operations",
    status: "Admin",
    description: "Manage source registries, county data, auth bootstrap, and internal system checks.",
    primaryAction: "Open admin",
  },
];

export const realEstatePipeline = [
  "Harvester",
  "Seller Engine",
  "Nexus",
  "Deal Engine",
  "Buyer Engine",
] as const;
