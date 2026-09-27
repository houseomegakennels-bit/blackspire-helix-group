import { defineCapability } from './contract.js';

const RESULT_KEYS = [
  'dealId',
  'propertyAddress',
  'county',
  'status',
  'motivationScore',
  'mao',
  'assignmentFee',
  'exitStrategy',
  'nextAction',
  'dealRating',
  'readyForContract',
  'missingInputs',
];
const TEXT_MAX = 500;

function boundedText(value, key, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > TEXT_MAX) throw new Error(`invalid deal record ${key}`);
  return value.trim();
}

function input(raw) {
  const value = raw ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['limit'].includes(key))) throw new Error('invalid deal records input');
  const limit = value.limit === undefined ? 5 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('deal records limit must be 1 through 10');
  return Object.freeze({ limit });
}

function output(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['deals','sourceSnapshotAt'].includes(key))) throw new Error('invalid deal records result');
  if (!Array.isArray(raw.deals) || raw.deals.length > 10) throw new Error('invalid deal records result count');
  const deals = raw.deals.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !RESULT_KEYS.includes(key))) throw new Error('invalid deal record fields');
    const score = Number(row.motivationScore);
    if (!Number.isSafeInteger(score) || score < 0 || score > 100) throw new Error('invalid deal motivation score');
    const missingInputs = Array.isArray(row.missingInputs) ? row.missingInputs.slice(0, 8) : [];
    if (missingInputs.some((item) => typeof item !== 'string' || item.length > TEXT_MAX)) throw new Error('invalid deal missingInputs');
    return Object.freeze({
      dealId: boundedText(row.dealId, 'dealId'),
      propertyAddress: boundedText(row.propertyAddress, 'propertyAddress'),
      county: boundedText(row.county, 'county', { nullable: true }),
      status: boundedText(row.status, 'status'),
      motivationScore: score,
      mao: boundedText(row.mao, 'mao'),
      assignmentFee: boundedText(row.assignmentFee, 'assignmentFee'),
      exitStrategy: boundedText(row.exitStrategy, 'exitStrategy'),
      nextAction: boundedText(row.nextAction, 'nextAction', { nullable: true }),
      dealRating: boundedText(row.dealRating, 'dealRating', { nullable: true }),
      readyForContract: Boolean(row.readyForContract),
      missingInputs,
    });
  });
  for (let i = 1; i < deals.length; i += 1) {
    if (deals[i - 1].motivationScore < deals[i].motivationScore) throw new Error('deal records must be deterministically ranked');
  }
  const sourceSnapshotAt = boundedText(raw.sourceSnapshotAt, 'sourceSnapshotAt');
  if (!Number.isFinite(Date.parse(sourceSnapshotAt))) throw new Error('invalid deal source snapshot timestamp');
  return Object.freeze({ deals, sourceSnapshotAt });
}

export const dealRecordsCapability = defineCapability({
  id: 'deal.records.search',
  division: 'deal-engine',
  purpose: 'Return the highest-ranked persisted Deal Engine records in one authorized workspace.',
  workspaceScope: 'exact-task-workspace',
  executionIntent: 'read_only',
  requiredPermissions: ['deal.records.read'],
  riskClass: 'low',
  approval: 'none',
  input,
  output,
  evidence: 'bounded capability selection, dispatch, source snapshot, and result metadata; no raw division rows',
  cancellation: 'check before dispatch and after response; late results are ignored',
  idempotency: 'one durable dispatch identity per task and capability; uncertain execution is never replayed automatically',
  sourceRequirements: ['deal-engine-canonical-deal-leads'],
  secretBoundary: 'division-scoped service credential remains outside task text, results, evidence, and ZOLA',
  timeoutMs: 10_000,
  budget: { maxCostCents: 0 },
  auditEvents: ['capability.selected','capability.dispatch_started','capability.completed','capability.prevented'],
  compensation: 'read-only; no rollback action; cancellation discards late output',
  execute: async (context, validatedInput) => context.adapters.dealRecords({ ...validatedInput, workspaceId: context.workspace.id, signal: context.signal }),
});

function reportText(value, limit = 80) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function summarizeDealRecords(result) {
  const count = result.deals.length;
  if (!count) return 'No Deal Engine records were returned for this workspace. This does not establish that no deals exist elsewhere.';
  const flagsFor = (row) => [
    ...(/\b(?:test|demo|sample|fixture)\b/i.test(row.propertyAddress) ? ['Possible test record — verify'] : []),
    ...(/^(?:unknown property|unknown|n\/a|tbd)$/i.test(row.propertyAddress.trim()) ? ['Property identity missing'] : []),
    ...(row.missingInputs.length ? ['Incomplete information'] : []),
  ];
  const candidate = result.deals.find(row => flagsFor(row).length === 0);
  const focus = candidate
    ? `Review first: ${reportText(candidate.propertyAddress, 65)} — highest motivation score among returned records without the flags below. This is a review order, not a verified investment recommendation.`
    : 'Review first: resolve the flagged records before choosing a deal to pursue.';
  const header = `Deal status — ${count} retrieved (up to 5 by default; this is not a full pipeline count).\nSnapshot: ${result.sourceSnapshotAt}\n${focus}`;
  const footer = 'Latest activity is not supplied by this source. Contract readiness and figures are recorded values, not independent verification. Flags are advisory; no records were changed.';
  const budget = Math.floor((3500 - header.length - footer.length - 40) / count);
  const lines = result.deals.map((row, index) => {
    const flags = flagsFor(row);
    const parts = [
      `${index + 1}. ${reportText(row.propertyAddress, 65)} (${reportText(row.dealId, 24)})`,
      `Stage: ${reportText(row.status, 40)}`,
      ...(flags.length ? [`Check: ${flags.join('; ')}`] : []),
      `Next: ${reportText(row.nextAction || 'No next action recorded.', 110)}`,
      `Missing: ${row.missingInputs.length ? reportText(row.missingInputs.join('; '), 120) : 'None reported; completeness not verified.'}`,
      `Motivation: ${row.motivationScore}/100; MAO: ${reportText(row.mao, 25)}; contract-ready: ${row.readyForContract ? 'recorded yes' : 'not recorded as ready'}`,
      `Strategy: ${reportText(row.exitStrategy, 70)}`,
    ];
    const text = parts.join('\n');
    return text.length > budget ? `${text.slice(0, budget - 26)}… [more detail available]` : text;
  });
  return `${header}\n\n${lines.join('\n\n')}\n\n${footer}`;
}
