import { defineCapability, validateCapabilityInput, validateCapabilityOutput } from './contract.js';

const RESULT_KEYS = [
  'opportunityId','buyerId','displayName','matchScore','matchReasons','recommendedAction','source',
];
const TEXT_MAX = 500;

function boundedText(value, key, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > TEXT_MAX) throw new Error(`invalid buyer match ${key}`);
  return value.trim();
}

function input(raw) {
  const value = raw == null ? null : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid buyer matches input');
  const allowed = ['opportunityId','propertyAddress','county','city','state','postalCode','propertyType','minBeds','maxPrice','limit'];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`unknown buyer match input fields: ${unknown.join(',')}`);
  const limit = value.limit === undefined ? 5 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('buyer match limit must be 1 through 10');
  const filters = {
    opportunityId: boundedText(value.opportunityId, 'opportunityId', { nullable: true }),
    propertyAddress: boundedText(value.propertyAddress, 'propertyAddress', { nullable: true }),
    county: boundedText(value.county, 'county', { nullable: true }),
    city: boundedText(value.city, 'city', { nullable: true }),
    state: boundedText(value.state, 'state', { nullable: true }),
    postalCode: boundedText(value.postalCode, 'postalCode', { nullable: true }),
    propertyType: boundedText(value.propertyType, 'propertyType', { nullable: true }),
    minBeds: value.minBeds === undefined || value.minBeds === null ? null : Number(value.minBeds),
    maxPrice: value.maxPrice === undefined || value.maxPrice === null ? null : Number(value.maxPrice),
    limit,
  };
  if (filters.minBeds !== null && (!Number.isSafeInteger(filters.minBeds) || filters.minBeds < 0 || filters.minBeds > 20)) throw new Error('invalid buyer match minBeds');
  if (filters.maxPrice !== null && (!Number.isSafeInteger(filters.maxPrice) || filters.maxPrice <= 0 || filters.maxPrice > 50_000_000)) throw new Error('invalid buyer match maxPrice');
  return Object.freeze(filters);
}

function output(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['matches','sourceSnapshotAt'].includes(key))) throw new Error('invalid buyer matches result');
  if (!Array.isArray(raw.matches) || raw.matches.length > 10) throw new Error('invalid buyer match result count');
  const matches = raw.matches.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !RESULT_KEYS.includes(key))) throw new Error('invalid buyer match fields');
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
  for (let i = 1; i < matches.length; i += 1) {
    if (matches[i - 1].matchScore < matches[i].matchScore) throw new Error('buyer matches must be deterministically ranked');
  }
  const sourceSnapshotAt = boundedText(raw.sourceSnapshotAt, 'sourceSnapshotAt');
  if (!Number.isFinite(Date.parse(sourceSnapshotAt))) throw new Error('invalid buyer source snapshot timestamp');
  return Object.freeze({ matches, sourceSnapshotAt });
}

export const buyerMatchesCapability = defineCapability({
  id: 'buyer.matches.search',
  division: 'buyer-engine',
  purpose: 'Return ranked buyer-to-opportunity matches for one authorized workspace, reusing the canonical Buyer matching path.',
  workspaceScope: 'exact-task-workspace',
  executionIntent: 'read_only',
  requiredPermissions: ['buyer.matches.read'],
  riskClass: 'low',
  approval: 'none',
  input,
  output,
  evidence: 'bounded capability selection, dispatch, source snapshot, and result metadata; no raw division rows or secrets',
  cancellation: 'check before dispatch and after response; late results are ignored',
  idempotency: 'one durable dispatch identity per task and capability; uncertain execution is never replayed automatically',
  sourceRequirements: ['buyer-engine-canonical-matches'],
  secretBoundary: 'division-scoped service credential remains outside task text, results, evidence, and ZOLA',
  timeoutMs: 10_000,
  budget: { maxCostCents: 0 },
  auditEvents: ['capability.selected','capability.dispatch_started','capability.completed','capability.prevented'],
  compensation: 'read-only; no rollback action; cancellation discards late output',
  execute: async (context, validatedInput) => context.adapters.buyerProfiles({ ...validatedInput, workspaceId: context.workspace.id, signal: context.signal, matchesOnly: true }),
});

export function summarizeBuyerMatches(result) {
  if (!result.matches.length) return 'No Buyer Engine matches are currently available in this workspace.';
  const lines = result.matches.slice(0, 5).map((match, index) => `${index + 1}. ${match.displayName} — match score ${match.matchScore}/100 for ${match.opportunityId}`);
  return `Buyer Engine matches:\\n${lines.join('\\n')}`;
}
