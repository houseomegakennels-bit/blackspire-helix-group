import { defineCapability } from './contract.js';

const RESULT_KEYS = [
  'dealId',
  'propertyAddress',
  'county',
  'status',
  'motivationScore',
  'estimatedArv',
  'sellerAskingPrice',
  'repairEstimate',
  'closingCosts',
  'holdingCosts',
  'buyerProfitTarget',
  'assignmentFeeTarget',
  'rentalEstimate',
  'flipEstimate',
  'purchasePriceTarget',
  'maximumAllowableOffer',
  'wholesaleSpread',
  'dealRating',
  'missingInputs',
  'readyForContract',
  'compliance',
  'sourceSnapshotAt',
];
const COMPLIANCE_KEYS = ['strategy','disclosureHeadline','licenseNote','marketingRule','earnestMoneyRule','cancellationRule','contractWarnings','checklist'];
const TEXT_MAX = 500;

function boundedText(value, key, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > TEXT_MAX) throw new Error(`invalid deal analysis ${key}`);
  return value.trim();
}

function input(raw) {
  const value = raw ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['dealId','_limit','_taskRequest','limit'].includes(key))) throw new Error('invalid deal analysis input');
  // If dealId is provided, validate it; otherwise leave null and let execute() extract from taskRequest.
  if (value.dealId !== undefined) {
    const normalized = String(value.dealId).trim().toUpperCase();
    if (!/^DE-\d{4}$/.test(normalized)) throw new Error('invalid deal analysis input: deal identifier missing or malformed');
    return Object.freeze({ dealId: normalized });
  }
  return Object.freeze({ dealId: null });
}

function extractDealId(text) {
  const match = String(text).match(/\bDE-\d{4}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function output(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !RESULT_KEYS.includes(key))) throw new Error('invalid deal analysis result');
  const score = Number(raw.motivationScore);
  if (!Number.isSafeInteger(score) || score < 0 || score > 100) throw new Error('invalid deal motivation score');
  if (!Array.isArray(raw.missingInputs)) throw new Error('invalid deal missingInputs: must be an array');
  const missingInputs = raw.missingInputs.slice(0, 8);
  if (missingInputs.some((item) => typeof item !== 'string' || item.length > TEXT_MAX)) throw new Error('invalid deal missingInputs');
  const compliance = raw.compliance;
  if (!compliance || typeof compliance !== 'object' || Array.isArray(compliance) || Object.keys(compliance).some((key) => !COMPLIANCE_KEYS.includes(key))) throw new Error('invalid deal compliance');
  if (!Array.isArray(compliance.contractWarnings)) throw new Error('invalid deal contractWarnings');
  const warnings = compliance.contractWarnings.slice(0, 8);
  if (warnings.some((item) => typeof item !== 'string' || item.length > TEXT_MAX)) throw new Error('invalid deal contractWarnings');
  if (!Array.isArray(compliance.checklist)) throw new Error('invalid deal checklist');
  const checklist = compliance.checklist.slice(0, 12);
  if (checklist.some((item) => typeof item !== 'string' || item.length > TEXT_MAX)) throw new Error('invalid deal checklist');
  const validatedCompliance = Object.freeze({
    strategy: boundedText(compliance.strategy, 'strategy'),
    disclosureHeadline: boundedText(compliance.disclosureHeadline, 'disclosureHeadline'),
    licenseNote: boundedText(compliance.licenseNote, 'licenseNote'),
    marketingRule: boundedText(compliance.marketingRule, 'marketingRule'),
    earnestMoneyRule: boundedText(compliance.earnestMoneyRule, 'earnestMoneyRule'),
    cancellationRule: boundedText(compliance.cancellationRule, 'cancellationRule'),
    contractWarnings: warnings.map((w) => boundedText(w, 'contractWarning')),
    checklist: checklist.map((c) => boundedText(c, 'checklistItem')),
  });
  const sourceSnapshotAt = boundedText(raw.sourceSnapshotAt, 'sourceSnapshotAt');
  if (!Number.isFinite(Date.parse(sourceSnapshotAt))) throw new Error('invalid deal source snapshot timestamp');
  return Object.freeze({
    dealId: boundedText(raw.dealId, 'dealId'),
    propertyAddress: boundedText(raw.propertyAddress, 'propertyAddress'),
    county: boundedText(raw.county, 'county', { nullable: true }),
    status: boundedText(raw.status, 'status'),
    motivationScore: score,
    estimatedArv: Number(raw.estimatedArv) || 0,
    sellerAskingPrice: Number(raw.sellerAskingPrice) || 0,
    repairEstimate: Number(raw.repairEstimate) || 0,
    closingCosts: Number(raw.closingCosts) || 0,
    holdingCosts: Number(raw.holdingCosts) || 0,
    buyerProfitTarget: Number(raw.buyerProfitTarget) || 0,
    assignmentFeeTarget: Number(raw.assignmentFeeTarget) || 0,
    rentalEstimate: Number(raw.rentalEstimate) || 0,
    flipEstimate: Number(raw.flipEstimate) || 0,
    purchasePriceTarget: Number(raw.purchasePriceTarget) || 0,
    maximumAllowableOffer: Number(raw.maximumAllowableOffer) || 0,
    wholesaleSpread: Number(raw.wholesaleSpread) || 0,
    dealRating: boundedText(raw.dealRating, 'dealRating', { nullable: true }),
    missingInputs,
    readyForContract: Boolean(raw.readyForContract),
    compliance: validatedCompliance,
    sourceSnapshotAt,
  });
}

export const dealAnalysisCapability = defineCapability({
  id: 'deal.analysis.get',
  division: 'deal-engine',
  purpose: 'Return canonical underwriting and detail for one authorized Deal Engine record.',
  workspaceScope: 'exact-task-workspace',
  executionIntent: 'read_only',
  requiredPermissions: ['deal.analysis.read'],
  riskClass: 'low',
  approval: 'none',
  input,
  output,
  evidence: 'bounded capability selection, dispatch, source snapshot, and result metadata; no raw division rows',
  cancellation: 'check before dispatch and after response; late results are ignored',
  idempotency: 'one durable dispatch identity per task and capability; uncertain execution is never replayed automatically',
  sourceRequirements: ['deal-engine-canonical-deal-underwriting'],
  secretBoundary: 'division-scoped service credential remains outside task text, results, evidence, and ZOLA',
  timeoutMs: 10_000,
  budget: { maxCostCents: 0 },
  auditEvents: ['capability.selected','capability.dispatch_started','capability.completed','capability.prevented'],
  compensation: 'read-only; no rollback action; cancellation discards late output',
  execute: async (context, validatedInput) => {
    // For deal.analysis, the dealId must be extracted from the natural-language task request
    // since executeRegisteredCapability cannot know to pass it. We re-derive the dealId from
    // context.taskRequest. The original validatedInput (with limit) is used so the limit check
    // in executeRegisteredCapability remains consistent (capabilityResultCount returns 1 for
    // deal.analysis which is <= the validatedInput.limit of 5).
    const dealId = extractDealId(String(context.taskRequest || ''));
    if (!dealId || !/^DE-\d{4}$/.test(dealId)) throw new Error('deal identifier missing from task request');
    return context.adapters.dealAnalysis({ dealId, workspaceId: context.workspace.id, signal: context.signal });
  },
});

export function summarizeDealAnalysis(result) {
  if (!result.dealId) return 'No Deal Engine analysis is available.';
  const { dealId, propertyAddress, estimatedArv, maximumAllowableOffer, dealRating, missingInputs, readyForContract } = result;
  const rating = dealRating ? ` — ${dealRating}` : '';
  const ready = readyForContract ? ' [contract-ready]' : '';
  const missing = missingInputs.length ? ` | Missing: ${missingInputs.join(', ')}` : '';
  const formatCurrency = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
  return `Deal ${dealId} underwriting for ${propertyAddress}:${rating}${ready}\nARV: ${formatCurrency(estimatedArv)} | MAO: ${formatCurrency(maximumAllowableOffer)}${missing}`;
}
