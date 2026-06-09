import "server-only";

import { listAllBuyerReports } from "@/lib/buyer-engine-server";
import { getDealEngineWorkspaceSnapshot } from "@/lib/deal-engine-server";
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
  const [sellerLeads, nexusSnapshot, dealSnapshot, buyerReports] = await Promise.all([
    listSellerLeads().catch(() => []),
    getNexusSnapshot().catch(() => null),
    getDealEngineWorkspaceSnapshot().catch(() => null),
    listAllBuyerReports({ limit: 200, offset: 0 }).then((result) => result.reports).catch(() => []),
  ]);

  const sellerLeadCount = sellerLeads.length;
  const contactsEnriched = nexusSnapshot?.contacts.length ?? 0;
  const dealsAnalyzed = dealSnapshot?.leads.length ?? 0;
  const buyerMatches = buyerReports.length;
  const projectedAssignmentFees = dealSnapshot?.metrics.find((item) => item.label === "Projected Assignment Fees")?.value ?? "$0";
  const closedTransactions = dealSnapshot?.stageBoard.find((item) => item.label === "Buyer Follow-Up")?.count ?? 0;

  const metrics: RealEstateDashboardMetric[] = [
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
      label: "Deals Analyzed",
      value: String(dealsAnalyzed).padStart(2, "0"),
      detail: "Active opportunities modeled inside Deal Engine.",
    },
    {
      label: "Buyer Matches",
      value: String(buyerMatches).padStart(2, "0"),
      detail: "Buyer dossiers available for exit activation.",
    },
    {
      label: "Projected Assignment Fees",
      value: projectedAssignmentFees,
      detail: "Modeled spread across the current deal queue.",
    },
    {
      label: "Closed Transactions",
      value: String(closedTransactions).padStart(2, "0"),
      detail: "Pipeline proxy until close-state automation is expanded.",
    },
  ];

  return {
    engines: realEstateEngines,
    metrics,
    flow: [
      "Seller Engine",
      "Nexus",
      "Deal Engine",
      "Buyer Engine",
      "Closed Transaction",
    ],
    ecosystemProjects: ecosystemProjects.filter((project) =>
      ["seller-engine", "nexus", "deal-engine", "buyer-engine"].includes(project.slug),
    ),
  };
}
