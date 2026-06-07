export type BuyerGroupType = "hedge_fund_group";

export type BuyerGroupMatch = {
  canonicalName: string;
  groupType: BuyerGroupType;
  matchedAlias: string;
  confidence: "high" | "medium";
  note: string;
};

type BuyerGroupSeed = {
  canonicalName: string;
  groupType: BuyerGroupType;
  aliases: string[];
};

const LEGAL_SUFFIXES = [
  "llc",
  "inc",
  "corp",
  "corporation",
  "co",
  "company",
  "lp",
  "l p",
  "llp",
  "ltd",
  "limited",
  "holdings",
  "holding",
  "properties",
  "property",
  "homes",
  "home",
  "residential",
  "ventures",
  "venture",
  "acquisitions",
  "acquisition",
  "owner",
  "owners",
];

const BUYER_GROUP_SEEDS: BuyerGroupSeed[] = [
  {
    canonicalName: "Invitation Homes",
    groupType: "hedge_fund_group",
    aliases: ["invitation homes", "invitation homes lp", "ih2 property"],
  },
  {
    canonicalName: "American Homes 4 Rent",
    groupType: "hedge_fund_group",
    aliases: ["american homes 4 rent", "american homes for rent", "amh", "amh borrowe"],
  },
  {
    canonicalName: "Progress Residential",
    groupType: "hedge_fund_group",
    aliases: ["progress residential", "progress residential borrower", "pr borrower"],
  },
  {
    canonicalName: "Tricon Residential",
    groupType: "hedge_fund_group",
    aliases: ["tricon residential", "tricon american homes", "tricon", "tah"],
  },
  {
    canonicalName: "Main Street Renewal",
    groupType: "hedge_fund_group",
    aliases: ["main street renewal", "ms renewal", "msr"],
  },
  {
    canonicalName: "FirstKey Homes",
    groupType: "hedge_fund_group",
    aliases: ["firstkey homes", "first key homes", "fk homes"],
  },
  {
    canonicalName: "VineBrook Homes",
    groupType: "hedge_fund_group",
    aliases: ["vinebrook homes", "vine brook homes", "vb one", "vb homes"],
  },
  {
    canonicalName: "Amherst",
    groupType: "hedge_fund_group",
    aliases: ["amherst", "amherst residential", "amherst holdings"],
  },
];

function normalizeEntityName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLegalNoise(value: string) {
  return value
    .split(" ")
    .filter((token) => token && !LEGAL_SUFFIXES.includes(token))
    .join(" ")
    .trim();
}

function buildComparableNames(name: string) {
  const normalized = normalizeEntityName(name);
  const simplified = stripLegalNoise(normalized);
  return [...new Set([normalized, simplified].filter(Boolean))];
}

export function matchBuyerGroup(buyerName: string | null | undefined): BuyerGroupMatch | null {
  if (!buyerName) return null;

  const comparableNames = buildComparableNames(buyerName);
  if (!comparableNames.length) return null;

  for (const group of BUYER_GROUP_SEEDS) {
    for (const alias of group.aliases) {
      const comparableAliases = buildComparableNames(alias);
      for (const comparableAlias of comparableAliases) {
        if (!comparableAlias) continue;
        if (comparableNames.some((name) => name === comparableAlias)) {
          return {
            canonicalName: group.canonicalName,
            groupType: group.groupType,
            matchedAlias: alias,
            confidence: "high",
            note: `${group.canonicalName} matched from buyer entity alias "${alias}".`,
          };
        }

        if (
          comparableAlias.length >= 8 &&
          comparableNames.some((name) => name.includes(comparableAlias) || comparableAlias.includes(name))
        ) {
          return {
            canonicalName: group.canonicalName,
            groupType: group.groupType,
            matchedAlias: alias,
            confidence: "medium",
            note: `${group.canonicalName} matched from approximate buyer entity alias "${alias}".`,
          };
        }
      }
    }
  }

  return null;
}

export function listSeedBuyerGroups() {
  return BUYER_GROUP_SEEDS.map((group) => ({
    canonicalName: group.canonicalName,
    groupType: group.groupType,
    aliases: [...group.aliases],
  }));
}
