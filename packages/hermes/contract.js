import { id, redact } from '../shared/util.js';

export const HERMES_CONTRACT_VERSION = '1';
export const HERMES_MAX_RESPONSE_BYTES = 16_384;
export const DENIED_CAPABILITY_CLASSES = Object.freeze([
  'approvals', 'authority', 'identity', 'workspace', 'channels', 'canonical_ids',
  'budgets', 'provider_selection', 'credentials', 'deployment', 'merge',
  'repository_operations', 'host_security', 'emergency_controls',
  'constitutional_changes', 'trading', 'broker_access', 'positions', 'funds_movement',
]);

const REQUEST_KEYS = ['version','requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel','objective','permittedSkillToolClasses','deniedCapabilityClasses','costCeilingCents','deadline','cancellationReference','evidenceTraceReference','idempotencyKey'];
const RESPONSE_KEYS = ['version','requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel','costCeilingCents','provider','model','status','summary'];

export function createHermesRequest({ task, actorId, workspace, permittedSkillToolClasses = ['read','status'], timeoutMs = 30_000 }) {
  const deadline = new Date(Math.min(Date.now() + timeoutMs, Date.parse(task.deadline || '') || Infinity)).toISOString();
  return {
    version: HERMES_CONTRACT_VERSION,
    requestId: id('hermes'),
    canonicalConversationId: task.conversation_id || `task:${task.id}`,
    canonicalTaskId: task.id,
    actorId: String(actorId || ''),
    workspaceId: workspace.id,
    channel: task.source_channel || 'api',
    objective: redact(String(task.request || '').trim()).slice(0, 4000),
    permittedSkillToolClasses: [...permittedSkillToolClasses],
    deniedCapabilityClasses: [...DENIED_CAPABILITY_CLASSES],
    costCeilingCents: Number(task.budget_cents || 0),
    deadline,
    cancellationReference: `task:${task.id}:cancellation`,
    evidenceTraceReference: `task:${task.id}:evidence`,
    idempotencyKey: task.idempotency_key,
  };
}

export function validateHermesRequest(contract) {
  exactKeys(contract, REQUEST_KEYS, 'Hermes request');
  if (contract.version !== HERMES_CONTRACT_VERSION) throw new Error('unknown Hermes contract version');
  for (const key of ['requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel','objective','deadline','cancellationReference','evidenceTraceReference','idempotencyKey']) requireString(contract, key);
  if (!Number.isSafeInteger(contract.costCeilingCents) || contract.costCeilingCents < 0) throw new Error('invalid Hermes cost ceiling');
  if (!Array.isArray(contract.permittedSkillToolClasses) || !Array.isArray(contract.deniedCapabilityClasses)) throw new Error('invalid Hermes capability classes');
  if (Date.parse(contract.deadline) <= Date.now()) throw new Error('Hermes deadline expired');
  return contract;
}

export function validateHermesResponse(raw, request, { allowedProviders = ['mock'] } = {}) {
  const bytes = Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw || {}));
  if (bytes > HERMES_MAX_RESPONSE_BYTES) throw new Error('Hermes response too large');
  let response;
  try { response = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('malformed Hermes response'); }
  exactKeys(response, RESPONSE_KEYS, 'Hermes response');
  if (response.version !== HERMES_CONTRACT_VERSION) throw new Error('unknown Hermes response version');
  for (const key of ['requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel','provider','status','summary']) requireString(response, key);
  for (const key of ['requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel']) if (response[key] !== request[key]) throw new Error(`Hermes response changed ${key}`);
  if (response.costCeilingCents !== request.costCeilingCents) throw new Error('Hermes response changed budget');
  if (!allowedProviders.includes(response.provider)) throw new Error('Hermes selected unauthorized provider');
  if (!['selected','prevented'].includes(response.status)) throw new Error('invalid Hermes response status');
  return response;
}

export function mockHermesResponse(request) {
  return { version: request.version, requestId: request.requestId, canonicalConversationId: request.canonicalConversationId, canonicalTaskId: request.canonicalTaskId, actorId: request.actorId, workspaceId: request.workspaceId, channel: request.channel, costCeilingCents: request.costCeilingCents, provider: 'mock', model: 'mock-hermes-status-v1', status: 'selected', summary: 'Mock Hermes selected the credential-free mock provider.' };
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} contains missing or unknown fields`);
}
function requireString(value, key) { if (typeof value[key] !== 'string' || !value[key]) throw new Error(`invalid Hermes ${key}`); }
