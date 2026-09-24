import { defineCapability, SECRET_KEY } from './contract.js';

const RESULT_KEYS = [
  'ownerName',
  'propertyAddress',
  'skipTraceStatus',
  'phoneStatus',
  'contactConfidenceScore',
  'provider',
  'source',
  'updatedAt',
  'sourceSnapshotAt',
];

function boundedText(value, key, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`invalid nexus enrichment ${key}`);
  return value.trim();
}

function input(raw) {
  const value = raw ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid nexus enrichment input');
  const keys = Object.keys(value);
  if (keys.some((k) => !['ownerName', 'propertyAddress', 'sellerLeadId', 'dealId'].includes(k))) throw new Error('invalid nexus enrichment input');
  const hasOwnerName = typeof value.ownerName === 'string' && value.ownerName.trim().length > 0;
  const hasPropertyAddress = typeof value.propertyAddress === 'string' && value.propertyAddress.trim().length > 0;
  const hasSellerLeadId = typeof value.sellerLeadId === 'string' && value.sellerLeadId.trim().length > 0;
  const hasDealId = typeof value.dealId === 'string' && /^DE-\d{4}$/i.test(value.dealId.trim());
  if (!hasOwnerName && !hasPropertyAddress && !hasSellerLeadId && !hasDealId) {
    throw new Error('nexus enrichment input must contain ownerName, propertyAddress, sellerLeadId, or dealId');
  }
  return Object.freeze({
    ownerName: hasOwnerName ? boundedText(value.ownerName, 'ownerName') : null,
    propertyAddress: hasPropertyAddress ? boundedText(value.propertyAddress, 'propertyAddress') : null,
    sellerLeadId: hasSellerLeadId ? boundedText(value.sellerLeadId, 'sellerLeadId') : null,
    dealId: hasDealId ? value.dealId.trim().toUpperCase() : null,
  });
}

function output(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid nexus enrichment result');
  const keys = Object.keys(raw);
  // Check for secret-shaped keys first (before unknown-key rejection)
  for (const key of keys) { if (SECRET_KEY.test(key)) throw new Error('capability output contains a secret-shaped field'); }
  if (keys.some((k) => !RESULT_KEYS.includes(k))) throw new Error('invalid nexus enrichment result');
  const sourceSnapshotAt = boundedText(raw.sourceSnapshotAt, 'sourceSnapshotAt');
  if (!Number.isFinite(Date.parse(sourceSnapshotAt))) throw new Error('invalid nexus enrichment source snapshot timestamp');
  let contactConfidenceScore;
  if (raw.contactConfidenceScore === null || raw.contactConfidenceScore === undefined) {
    contactConfidenceScore = null;
  } else {
    const score = Number(raw.contactConfidenceScore);
    if (!Number.isSafeInteger(score) || score < 0 || score > 100) throw new Error('invalid nexus enrichment contact confidence score');
    contactConfidenceScore = score;
  }
  return Object.freeze({
    ownerName: boundedText(raw.ownerName, 'ownerName', { nullable: true }),
    propertyAddress: boundedText(raw.propertyAddress, 'propertyAddress', { nullable: true }),
    skipTraceStatus: boundedText(raw.skipTraceStatus, 'skipTraceStatus', { nullable: true }),
    phoneStatus: boundedText(raw.phoneStatus, 'phoneStatus', { nullable: true }),
    contactConfidenceScore,
    provider: boundedText(raw.provider, 'provider', { nullable: true }),
    source: boundedText(raw.source, 'source', { nullable: true }),
    updatedAt: boundedText(raw.updatedAt, 'updatedAt', { nullable: true }),
    sourceSnapshotAt,
  });
}

export const nexusEnrichmentCapability = defineCapability({
  id: 'nexus.enrichment.status',
  division: 'nexus',
  purpose: 'Return the canonical contact-enrichment status for one owner/property/lead without exposing raw contact PII.',
  workspaceScope: 'exact-task-workspace',
  executionIntent: 'read_only',
  requiredPermissions: ['nexus.enrichment.read'],
  riskClass: 'low',
  approval: 'none',
  input,
  output,
  evidence: 'bounded capability selection, dispatch, source snapshot, and result metadata; no raw division rows or contact PII',
  cancellation: 'check before dispatch and after response; late results are ignored',
  idempotency: 'one durable dispatch identity per task and capability; uncertain execution is never replayed automatically',
  sourceRequirements: ['nexus-canonical-contact-enrichment-status'],
  secretBoundary: 'division-scoped service credential and provider credentials remain outside task text, results, evidence, and ZOLA',
  timeoutMs: 10_000,
  budget: { maxCostCents: 0 },
  auditEvents: ['capability.selected', 'capability.dispatch_started', 'capability.completed', 'capability.prevented'],
  compensation: 'read-only; no rollback action; cancellation discards late output',
  execute: async (context, validatedInput) => {
    return context.adapters.nexusEnrichment({
      ...validatedInput,
      workspaceId: context.workspace.id,
      signal: context.signal,
    });
  },
});

export function summarizeNexusEnrichment(result) {
  if (!result.ownerName && !result.propertyAddress) return 'No Nexus enrichment status is available.';
  const { ownerName, propertyAddress, skipTraceStatus, contactConfidenceScore, phoneStatus } = result;
  const address = propertyAddress ? ` for ${propertyAddress}` : '';
  const owner = ownerName ? ` (${ownerName})` : '';
  const status = skipTraceStatus ? ` — ${skipTraceStatus}` : '';
  const confidence = contactConfidenceScore !== null ? ` [confidence ${contactConfidenceScore}]` : '';
  const phone = phoneStatus ? ` | Phone: ${phoneStatus}` : '';
  return `Nexus enrichment${address}${owner}:${status}${confidence}${phone}`;
}
