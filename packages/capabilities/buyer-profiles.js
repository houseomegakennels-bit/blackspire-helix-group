import { defineCapability, validateCapabilityInput, validateCapabilityOutput } from './contract.js';

const RESULT_KEYS = [
  'id',
  'displayName',
  'buyerType',
  'county',
  'state',
  'city',
  'postalCode',
  'propertyType',
  'minBeds',
  'maxPrice',
  'preferredRadius',
  'cashBuyer',
  'llcBuyer',
  'active',
  'buyBoxSummary',
  'scoreSummary',
  'source',
];
const TEXT_MAX = 500;

function boundedText(value, key, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > TEXT_MAX) throw new Error(`invalid buyer profile ${key}`);
  return value.trim();
}

function input(raw) {
  const value = raw == null ? null : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid buyer profiles input');
  const allowed = [
    'buyerName','buyerGroup','state','county','city','postalCodes','propertyType','buyerProfileType',
    'minBeds','maxPrice','preferredRadius','cashBuyer','llcBuyer','activeOnly','limit'
  ];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`unknown buyer profile input fields: ${unknown.join(',')}`);
  const limit = value.limit === undefined ? 5 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('buyer profile limit must be 1 through 10');
  const postalCodes = Array.isArray(value.postalCodes) ? value.postalCodes.slice(0, 20).map((item) => String(item).trim()).filter(Boolean) : [];
  if (postalCodes.some((item) => item.length > 10)) throw new Error('invalid buyer profile postalCodes');
  const filters = {
    buyerName: boundedText(value.buyerName, 'buyerName', { nullable: true }),
    buyerGroup: boundedText(value.buyerGroup, 'buyerGroup', { nullable: true }),
    state: boundedText(value.state, 'state', { nullable: true }),
    county: boundedText(value.county, 'county', { nullable: true }),
    city: boundedText(value.city, 'city', { nullable: true }),
    postalCodes,
    propertyType: boundedText(value.propertyType, 'propertyType', { nullable: true }),
    buyerProfileType: boundedText(value.buyerProfileType, 'buyerProfileType', { nullable: true }),
    minBeds: value.minBeds === undefined || value.minBeds === null ? null : Number(value.minBeds),
    maxPrice: value.maxPrice === undefined || value.maxPrice === null ? null : Number(value.maxPrice),
    preferredRadius: value.preferredRadius === undefined || value.preferredRadius === null ? null : Number(value.preferredRadius),
    cashBuyer: value.cashBuyer === undefined || value.cashBuyer === null ? null : Boolean(value.cashBuyer),
    llcBuyer: value.llcBuyer === undefined || value.llcBuyer === null ? null : Boolean(value.llcBuyer),
    activeOnly: Boolean(value.activeOnly),
    limit,
  };
  if (filters.minBeds !== null && (!Number.isSafeInteger(filters.minBeds) || filters.minBeds < 0 || filters.minBeds > 20)) throw new Error('invalid buyer profile minBeds');
  if (filters.maxPrice !== null && (!Number.isSafeInteger(filters.maxPrice) || filters.maxPrice <= 0 || filters.maxPrice > 50_000_000)) throw new Error('invalid buyer profile maxPrice');
  if (filters.preferredRadius !== null && (!Number.isSafeInteger(filters.preferredRadius) || filters.preferredRadius < 0 || filters.preferredRadius > 500)) throw new Error('invalid buyer profile preferredRadius');
  return Object.freeze(filters);
}

function output(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['profiles','matches','sourceSnapshotAt'].includes(key))) throw new Error('invalid buyer profiles result');
  if (Array.isArray(raw.profiles) && raw.profiles.length > 10) throw new Error('invalid buyer profiles result count');
  const profiles = Array.isArray(raw.profiles) ? raw.profiles.slice(0, 10) : [];
  if (profiles.length > 10) throw new Error('invalid buyer profiles result count');
  const normalizedProfiles = profiles.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !RESULT_KEYS.includes(key))) throw new Error('invalid buyer profile fields');
    const scoreSummary = boundedText(row.scoreSummary, 'scoreSummary', { nullable: true });
    const buyBoxSummary = boundedText(row.buyBoxSummary, 'buyBoxSummary', { nullable: true });
    return Object.freeze({
      id: boundedText(row.id, 'id'),
      displayName: boundedText(row.displayName, 'displayName'),
      buyerType: boundedText(row.buyerType, 'buyerType', { nullable: true }),
      county: boundedText(row.county, 'county', { nullable: true }),
      state: boundedText(row.state, 'state', { nullable: true }),
      city: boundedText(row.city, 'city', { nullable: true }),
      postalCode: boundedText(row.postalCode, 'postalCode', { nullable: true }),
      propertyType: boundedText(row.propertyType, 'propertyType', { nullable: true }),
      minBeds: row.minBeds === null || row.minBeds === undefined ? null : Number(row.minBeds),
      maxPrice: row.maxPrice === null || row.maxPrice === undefined ? null : Number(row.maxPrice),
      preferredRadius: row.preferredRadius === null || row.preferredRadius === undefined ? null : Number(row.preferredRadius),
      cashBuyer: Boolean(row.cashBuyer),
      llcBuyer: Boolean(row.llcBuyer),
      active: Boolean(row.active),
      buyBoxSummary,
      scoreSummary,
      source: boundedText(row.source, 'source'),
    });
  });
  const matches = Array.isArray(raw.matches) ? raw.matches.slice(0, 10) : [];
  if (matches.length > 10) throw new Error('invalid buyer match result count');
  const normalizedMatches = matches.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !['opportunityId','buyerId','displayName','matchScore','matchReasons','recommendedAction','source'].includes(key))) throw new Error('invalid buyer match fields');
    return Object.freeze({
      opportunityId: boundedText(row.opportunityId, 'opportunityId'),
      buyerId: boundedText(row.buyerId, 'buyerId'),
      displayName: boundedText(row.displayName, 'displayName'),
      matchScore: Math.max(0, Math.min(99, Number(row.matchScore) || 0)),
      matchReasons: Array.isArray(row.matchReasons) ? row.matchReasons.slice(0, 8).map((reason) => String(reason).trim()).filter(Boolean) : [],
      recommendedAction: boundedText(row.recommendedAction, 'recommendedAction', { nullable: true }),
      source: boundedText(row.source, 'source'),
    });
  });
  for (let i = 1; i < normalizedMatches.length; i += 1) {
    if (normalizedMatches[i - 1].matchScore < normalizedMatches[i].matchScore) throw new Error('buyer matches must be deterministically ranked');
  }
  const sourceSnapshotAt = boundedText(raw.sourceSnapshotAt, 'sourceSnapshotAt');
  if (!Number.isFinite(Date.parse(sourceSnapshotAt))) throw new Error('invalid buyer source snapshot timestamp');
  return Object.freeze({ profiles: normalizedProfiles, matches: normalizedMatches, sourceSnapshotAt });
}

export const buyerProfilesCapability = defineCapability({
  id: 'buyer.profiles.search',
  division: 'buyer-engine',
  purpose: 'Return bounded persisted buyer profiles and ranked buyer-to-opportunity matches for one authorized workspace.',
  workspaceScope: 'exact-task-workspace',
  executionIntent: 'read_only',
  requiredPermissions: ['buyer.profiles.read'],
  riskClass: 'low',
  approval: 'none',
  input,
  output,
  evidence: 'bounded capability selection, dispatch, source snapshot, and result metadata; no raw division rows or secrets',
  cancellation: 'check before dispatch and after response; late results are ignored',
  idempotency: 'one durable dispatch identity per task and capability; uncertain execution is never replayed automatically',
  sourceRequirements: ['buyer-engine-canonical-profiles', 'buyer-engine-canonical-matches'],
  secretBoundary: 'division-scoped service credential remains outside task text, results, evidence, and ZOLA',
  timeoutMs: 10_000,
  budget: { maxCostCents: 0 },
  auditEvents: ['capability.selected','capability.dispatch_started','capability.completed','capability.prevented'],
  compensation: 'read-only; no rollback action; cancellation discards late output',
  execute: async (context, validatedInput) => context.adapters.buyerProfiles({ ...validatedInput, workspaceId: context.workspace.id, signal: context.signal }),
});

export function summarizeBuyerProfiles(result) {
  if (!result.profiles.length && !result.matches.length) return 'No Buyer Engine profiles or matches are currently available in this workspace.';
  const lines = [];
  for (const profile of result.profiles.slice(0, 5)) {
    lines.push(`- ${profile.displayName} (${profile.buyerType || 'buyer'}) in ${[profile.city, profile.county, profile.state].filter(Boolean).join(', ') || 'unknown market'}${profile.active === false ? ' — inactive' : ''}`);
  }
  for (const match of result.matches.slice(0, 5)) {
    lines.push(`- ${match.displayName} — match score ${match.matchScore}/100 for ${match.opportunityId}`);
  }
  return `Buyer Engine read-only snapshot:\n${lines.join('\n')}`;
}
