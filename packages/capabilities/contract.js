import { redact } from '../shared/util.js';

const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,5}$/;
const EXECUTION_INTENTS = new Set(['read_only', 'workspace_mutation']);
const RISKS = new Set(['low', 'medium', 'high']);
const APPROVALS = new Set(['none', 'required']);
const SECRET_KEY = /(?:secret|token|credential|authorization|cookie|password|api[-_]?key|private[-_]?key)/i;
export const MAX_CAPABILITY_INPUT_BYTES = 8 * 1024;
export const MAX_CAPABILITY_OUTPUT_BYTES = 32 * 1024;

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(',')}`);
}

function strings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item || item.length > 128)) {
    throw new Error(`${label} must contain bounded strings`);
  }
}

/** Validate and deeply freeze one server-owned Blackspire capability definition. */
export function defineCapability(definition) {
  const keys = ['id','division','purpose','workspaceScope','executionIntent','requiredPermissions','riskClass','approval','input','output','evidence','cancellation','idempotency','sourceRequirements','secretBoundary','timeoutMs','budget','auditEvents','compensation','execute'];
  exactKeys(definition, keys, 'BlackspireCapability');
  if (!CAPABILITY_ID.test(definition.id)) throw new Error('invalid capability id');
  for (const key of ['division','purpose','workspaceScope','evidence','cancellation','idempotency','secretBoundary','compensation']) {
    if (typeof definition[key] !== 'string' || !definition[key] || definition[key].length > 500) throw new Error(`invalid capability ${key}`);
  }
  if (!EXECUTION_INTENTS.has(definition.executionIntent)) throw new Error('invalid capability execution intent');
  if (!RISKS.has(definition.riskClass)) throw new Error('invalid capability risk class');
  if (!APPROVALS.has(definition.approval)) throw new Error('invalid capability approval requirement');
  strings(definition.requiredPermissions, 'requiredPermissions');
  strings(definition.sourceRequirements, 'sourceRequirements');
  strings(definition.auditEvents, 'auditEvents');
  if (!definition.requiredPermissions.length) throw new Error('capability requires at least one permission');
  if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs < 100 || definition.timeoutMs > 60_000) throw new Error('invalid capability timeout');
  if (!definition.budget || !Number.isSafeInteger(definition.budget.maxCostCents) || definition.budget.maxCostCents < 0) throw new Error('invalid capability budget');
  if (typeof definition.input !== 'function' || typeof definition.output !== 'function' || typeof definition.execute !== 'function') throw new Error('capability validators and executor are required');
  return deepFreeze({ ...definition, requiredPermissions: [...definition.requiredPermissions], sourceRequirements: [...definition.sourceRequirements], auditEvents: [...definition.auditEvents] });
}

export function validateCapabilityInput(capability, raw) {
  const bytes = Buffer.byteLength(JSON.stringify(raw ?? null));
  if (bytes > MAX_CAPABILITY_INPUT_BYTES) throw new Error('capability input too large');
  return capability.input(raw);
}

export function validateCapabilityOutput(capability, raw) {
  const clean = capability.output(raw);
  rejectSecretShape(clean);
  const redacted = JSON.parse(redact(JSON.stringify(clean)));
  if (Buffer.byteLength(JSON.stringify(redacted)) > MAX_CAPABILITY_OUTPUT_BYTES) throw new Error('capability output too large');
  return redacted;
}

function rejectSecretShape(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('capability output must be acyclic');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error('capability output contains a secret-shaped field');
    rejectSecretShape(child, seen);
  }
  seen.delete(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const capabilityContractInternals = Object.freeze({ CAPABILITY_ID, EXECUTION_INTENTS, RISKS, APPROVALS });
