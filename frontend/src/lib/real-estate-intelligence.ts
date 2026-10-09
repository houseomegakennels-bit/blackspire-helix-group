import "server-only";

import { getHarvesterWorkspaceSnapshot } from "@/lib/harvester-server";
import { listAllBuyerReports } from "@/lib/buyer-engine-server";
import { getDealEnginePipelineSummary } from "@/lib/deal-engine-server";
import { ecosystemProjects } from "@/lib/ecosystem";
import { getNexusSnapshot } from "@/lib/nexus-server";
import { listSellerLeads } from "@/lib/seller-engine-server";

export type RealEstateEngineConfig = {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  colorScheme: string;
  status: "live" | "building";
  ecosystemPath: string;
  workspacePath: string;
  logoPath?: string;
};

export const realEstateEngines: RealEstateEngineConfig[] = [
  {
    id: "harvester",
    name: "Blackspire Harvester",
    slug: "harvester",
    tagline: "Opportunity Acquisition Intelligence.",
    description: "Captures screenshots, pasted posts, SMS, email, flyers, and PDFs, then extracts structured opportunities into the real-estate pipeline.",
    colorScheme: "gold/silver/black",
    status: "live",
    ecosystemPath: "/real-estate-intelligence/harvester",
    workspacePath: "/workspace/harvester",
    logoPath: "/logos/harvester-logo.png",
  },
  {
    id: "seller-engine",
    name: "Blackspire Seller Engine",
    slug: "seller-engine",
    tagline: "Find the Opportunity.",
    description: "Finds motivated seller opportunities and pressure signals.",
    colorScheme: "red/silver/black",
    status: "live",
    ecosystemPath: "/real-estate-intelligence/seller-engine",
    workspacePath: "/seller-engine",
    logoPath: "/brand/blackspire-seller-engine-logo.png",
  },
  {
    id: "nexus",
    name: "Blackspire Nexus",
    slug: "nexus",
    tagline: "Find the Decision Maker.",
    description: "Runs skip trace and resolves owner contact intelligence.",
    colorScheme: "purple/silver/black",
    status: "live",
    ecosystemPath: "/real-estate-intelligence/nexus",
    workspacePath: "/workspace/nexus",
    logoPath: "/brand/blackspire-nexus-logo.png",
  },
  {
    id: "deal-engine",
    name: "Blackspire Deal Engine",
    slug: "deal-engine",
    tagline: "Create the Opportunity.",
    description: "Analyzes leads, manages acquisition, drives AI commander recommendations, contracts, and deal packets.",
    colorScheme: "teal/gold/silver/black",
    status: "live",
    ecosystemPath: "/real-estate-intelligence/deal-engine",
    workspacePath: "/workspace/deal-engine",
    logoPath: "/brand/blackspire-deal-engine-logo.png",
  },
  {
    id: "buyer-engine",
    name: "Blackspire Buyer Engine",
    slug: "buyer-engine",
    tagline: "Create the Exit.",
    description: "Matches deals to buyers, generates outreach, and reverse-searches live inventory from buyer criteria.",
    colorScheme: "green/gold/black",
    status: "live",
    ecosystemPath: "/real-estate-intelligence/buyer-engine",
    workspacePath: "/workspace/buyer-engine",
    logoPath: "/brand/blackspire-buyer-engine-logo.png",
  },
];

export function getRealEstateEngineBySlug(slug: string) {
  return realEstateEngines.find((engine) => engine.slug === slug) ?? null;
}

export type RealEstateDashboardMetric = {
  label: string;
  value: string;
  detail: string;
};

export async function getRealEstateDivisionSnapshot() {
  const [harvesterSnapshot, sellerLeads, nexusSnapshot, dealSnapshot, buyerReports] = await Promise.all([
    getHarvesterWorkspaceSnapshot().catch(() => null),
    listSellerLeads().catch(() => []),
    getNexusSnapshot().catch(() => null),
    getDealEnginePipelineSummary().catch(() => null),
    listAllBuyerReports({ limit: 200, offset: 0 }).then((result) => result.reports).catch(() => []),
  ]);

  const harvesterIntakes = harvesterSnapshot?.intakes.length ?? 0;
  const sellerLeadCount = sellerLeads.length;
  const contactsEnriched = nexusSnapshot?.contacts.length ?? 0;
  const dealCount = dealSnapshot?.totalDeals;
  const buyerMatches = buyerReports.length;
  const projectedAssignmentFees = dealSnapshot?.projectedAssignmentFees ?? "Unavailable";
  const buyerFollowUps = dealSnapshot?.buyerFollowUps;

  const metrics: RealEstateDashboardMetric[] = [
    {
      label: "Intakes Captured",
      value: String(harvesterIntakes).padStart(2, "0"),
      detail: "Unstructured opportunities captured upstream in Harvester.",
    },
    {
      label: "Seller Leads Found",
      value: String(sellerLeadCount).padStart(2, "0"),
      detail: "Qualified opportunities flowing through Seller Engine.",
    },
    {
      label: "Contacts Enriched",
      value: String(contactsEnriched).padStart(2, "0"),
      detail: "Owner records with verified phone or contact posture in Nexus.",
    },
    {
      label: "Properties in Deal Engine",
      value: dealCount == null ? "Unavailable" : String(dealCount).padStart(2, "0"),
      detail: "Saved properties across the full Deal Engine pipeline.",
    },
    {
      label: "Buyer Matches",
      value: String(buyerMatches).padStart(2, "0"),
      detail: "Buyer dossiers available for exit activation.",
    },
    {
      label: "Projected Assignment Fees",
      value: projectedAssignmentFees,
      detail: "Known assignment fee targets across the full pipeline.",
    },
    {
      label: "Buyer Follow-Ups",
      value: buyerFollowUps == null ? "Unavailable" : String(buyerFollowUps).padStart(2, "0"),
      detail: "Properties in the buyer follow-up stage across the full pipeline.",
    },
  ];

  return {
    engines: realEstateEngines,
    metrics,
    flow: [
      "Harvester",
      "Seller Engine",
      "Nexus",
      "Deal Engine",
      "Buyer Engine",
      "Closed Transaction",
    ],
    ecosystemProjects: ecosystemProjects.filter((project) =>
      ["harvester", "seller-engine", "nexus", "deal-engine", "buyer-engine"].includes(project.slug),
    ),
  };
}
