/**
 * Centralized Blackspire Helix Group logo / brand-asset registry.
 * Every surface (navbar, sidebar, mobile nav, ecosystem cards, landing pages,
 * marketing pages) should pull logo paths from here so a logo swap is one edit.
 * Uploaded official logos only — do not generate replacements.
 */
export const brandAssets = {
  parent: {
    name: "Blackspire Helix Group",
    logo: "/brand/blackspire-helix-group-logo-fit.png",
  },
  reconEngine: {
    name: "Blackspire Recon Engine",
    logo: "/brand/blackspire-recon-engine-logo.png",
    tagline: "Opportunity Intelligence Before the Competition",
  },
  buyerEngine: {
    name: "Blackspire Buyer Engine",
    logo: "/brand/blackspire-buyer-engine-logo-v2.png",
  },
  sellerEngine: {
    name: "Blackspire Seller Engine",
    logo: "/brand/blackspire-seller-engine-logo.png",
    tagline: "Find Motivated Sellers. Fuel Great Deals.",
  },
  harvester: {
    name: "Blackspire Harvester",
    logo: "/logos/harvester-logo.png",
    mark: "/logos/harvester-mark.png",
    tagline: "Opportunity Acquisition Intelligence",
  },
  nexus: {
    name: "Blackspire Nexus",
    // Placeholder path. Replace this file with the official Nexus logo when uploaded.
    logo: "/brand/blackspire-nexus-logo.png",
    tagline: "Find the Decision Maker.",
  },
  dealEngine: {
    name: "Blackspire Deal Engine",
    logo: "/brand/blackspire-deal-engine-logo.png",
    tagline: "Analyze. Acquire. Match. Close.",
  },
  helixLawnCommand: {
    name: "Helix Lawn Command",
    logo: "/brand/helix-lawn-command-logo.png",
  },
  socialOs: {
    name: "Blackspire Social OS",
    logo: "/brand/blackspire-social-os-logo.png",
  },
  emberHalo: {
    name: "Ember Halo",
    logo: "/brand/ember-halo-logo.png",
  },
  oracleHelix: {
    name: "Oracle Helix",
    logo: "/brand/oracle-helix-logo.png",
  },
} as const;

export type BrandAssetKey = keyof typeof brandAssets;
