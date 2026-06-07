export type BuyerGroupType = "hedge_fund_group";

export type BuyerGroupRegistryEntry = {
  canonicalName: string;
  groupType: BuyerGroupType;
  aliases: string[];
  states?: string[];
  counties?: string[];
  website?: string | null;
  notes?: string | null;
  active?: boolean;
};

export type BuyerGroupMatch = {
  canonicalName: string;
  groupType: BuyerGroupType;
  matchedAlias: string;
  confidence: "high" | "medium";
  note: string;
};

type BuyerGroupSeed = BuyerGroupRegistryEntry;

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

export function matchBuyerGroupWithRegistry(
  buyerName: string | null | undefined,
  registry: BuyerGroupRegistryEntry[],
): BuyerGroupMatch | null {
  if (!buyerName) return null;

  const comparableNames = buildComparableNames(buyerName);
  if (!comparableNames.length) return null;

  for (const group of registry.filter((entry) => entry.active !== false)) {
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

export function matchBuyerGroup(buyerName: string | null | undefined): BuyerGroupMatch | null {
  return matchBuyerGroupWithRegistry(buyerName, BUYER_GROUP_SEEDS);
}

export function listSeedBuyerGroups() {
  return BUYER_GROUP_SEEDS.map((group) => ({
    canonicalName: group.canonicalName,
    groupType: group.groupType,
    aliases: [...group.aliases],
    states: [...(group.states ?? [])],
    counties: [...(group.counties ?? [])],
    website: group.website ?? null,
    notes: group.notes ?? null,
    active: group.active ?? true,
  }));
}

function splitMultiValue(value: string) {
  return value
    .split(/[|;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseBuyerGroupCsv(csv: string): BuyerGroupRegistryEntry[] {
  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      currentRow.push(currentField);
      if (currentRow.some((field) => field.trim().length)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  if (currentField.length || currentRow.length) {
    currentRow.push(currentField);
    if (currentRow.some((field) => field.trim().length)) {
      rows.push(currentRow);
    }
  }

  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim().toLowerCase());

  return rows.slice(1).map((row) => {
    const get = (...keys: string[]) => {
      for (const key of keys) {
        const index = headers.indexOf(key);
        if (index >= 0) return String(row[index] ?? "").trim();
      }
      return "";
    };

    const canonicalName = get("canonical_name", "canonical name", "name");
    const aliasField = get("aliases", "alias", "entity_aliases", "entity aliases");
    const aliases = [...new Set([canonicalName, ...splitMultiValue(aliasField)])].filter(Boolean);
    const groupTypeValue = get("group_type", "group type").toLowerCase();
    const groupType: BuyerGroupType = groupTypeValue === "hedge_fund_group" || !groupTypeValue
      ? "hedge_fund_group"
      : "hedge_fund_group";
    const activeValue = get("active", "status").toLowerCase();

    return {
      canonicalName,
      groupType,
      aliases,
      states: splitMultiValue(get("states", "state")),
      counties: splitMultiValue(get("counties", "county", "markets")),
      website: get("website", "url") || null,
      notes: get("notes", "note") || null,
      active: activeValue ? !["false", "0", "inactive", "no"].includes(activeValue) : true,
    };
  }).filter((entry) => entry.canonicalName && entry.aliases.length);
}
