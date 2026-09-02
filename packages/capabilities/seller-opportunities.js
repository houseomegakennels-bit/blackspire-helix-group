import { defineCapability } from './contract.js';

const RESULT_KEYS = ['leadId','propertyId','propertyAddress','county','city','state','postalCode','propertyType','status','motivationScore','category','reasons','recommendedAction','source'];
const TEXT_MAX = 500;

function boundedText(value, key, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > TEXT_MAX) throw new Error(`invalid seller opportunity ${key}`);
  return value.trim();
}

function input(raw) {
  const value = raw ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['limit'].includes(key))) throw new Error('invalid seller opportunities input');
  const limit = value.limit === undefined ? 5 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('seller opportunities limit must be 1 through 10');
  return Object.freeze({ limit });
}

function output(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['opportunities','sourceSnapshotAt'].includes(key))) throw new Error('invalid seller opportunities result');
  if (!Array.isArray(raw.opportunities) || raw.opportunities.length > 10) throw new Error('invalid seller opportunities result count');
  const opportunities = raw.opportunities.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !RESULT_KEYS.includes(key))) throw new Error('invalid seller opportunity fields');
    const score = Number(row.motivationScore);
    if (!Number.isSafeInteger(score) || score < 0 || score > 100) throw new Error('invalid seller opportunity score');
    if (!Array.isArray(row.reasons) || row.reasons.length > 12 || row.reasons.some((reason) => typeof reason !== 'string' || reason.length > TEXT_MAX)) throw new Error('invalid seller opportunity reasons');
    return Object.freeze({
      leadId: boundedText(row.leadId, 'leadId'), propertyId: boundedText(row.propertyId, 'propertyId'),
      propertyAddress: boundedText(row.propertyAddress, 'propertyAddress'), county: boundedText(row.county, 'county', { nullable: true }),
      city: boundedText(row.city, 'city', { nullable: true }), state: boundedText(row.state, 'state', { nullable: true }),
      postalCode: boundedText(row.postalCode, 'postalCode', { nullable: true }), propertyType: boundedText(row.propertyType, 'propertyType', { nullable: true }),
      status: boundedText(row.status, 'status'), motivationScore: score, category: boundedText(row.category, 'category'),
      reasons: row.reasons.map((reason) => reason.trim()).filter(Boolean), recommendedAction: boundedText(row.recommendedAction, 'recommendedAction', { nullable: true }),
      source: boundedText(row.source, 'source'),
    });
  });
  for (let i = 1; i < opportunities.length; i += 1) if (opportunities[i - 1].motivationScore < opportunities[i].motivationScore) throw new Error('seller opportunities must be deterministically ranked');
  const sourceSnapshotAt = boundedText(raw.sourceSnapshotAt, 'sourceSnapshotAt');
  if (!Number.isFinite(Date.parse(sourceSnapshotAt))) throw new Error('invalid seller source snapshot timestamp');
  return Object.freeze({ opportunities, sourceSnapshotAt });
}

export const sellerOpportunityCapability = defineCapability({
  id: 'seller.opportunities.search', division: 'seller-engine', purpose: 'Return the highest-ranked persisted seller/property opportunities in one authorized workspace.',
  workspaceScope: 'exact-task-workspace', executionIntent: 'read_only', requiredPermissions: ['seller.opportunities.read'], riskClass: 'low', approval: 'none',
  input, output, evidence: 'bounded capability selection, dispatch, source snapshot, and result metadata; no raw division rows',
  cancellation: 'check before dispatch and after response; late results are ignored', idempotency: 'one durable dispatch identity per task and capability; uncertain execution is never replayed automatically',
  sourceRequirements: ['seller-engine-canonical-properties', 'seller-engine-canonical-leads'], secretBoundary: 'division-scoped service credential remains outside task text, results, evidence, and Jarvis',
  timeoutMs: 10_000, budget: { maxCostCents: 0 }, auditEvents: ['capability.selected','capability.dispatch_started','capability.completed','capability.prevented'],
  compensation: 'read-only; no rollback action; cancellation discards late output', execute: async (context, validatedInput) => context.adapters.sellerOpportunities({ ...validatedInput, workspaceId: context.workspace.id, signal: context.signal }),
});

export function summarizeSellerOpportunities(result) {
  if (!result.opportunities.length) return 'No persisted Seller Engine opportunities are currently available in this workspace.';
  const lines = result.opportunities.map((row, index) => `${index + 1}. ${row.propertyAddress} — score ${row.motivationScore}/100 (${row.category}); ${row.reasons.slice(0, 3).join(', ') || 'no motivation reasons recorded'}.`);
  return `Best Seller Engine opportunities:\n${lines.join('\n')}`;
}
