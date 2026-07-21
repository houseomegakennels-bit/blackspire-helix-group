import { evaluateRequestPolicy } from '../policy/policy.js';
import { getFlag, getTask, taskRecords } from '../task-engine/tasks.js';

const PLACEHOLDER = /^(?:replace|change|example|placeholder|default|test|your[-_]|changeme|dev-admin-token-change-me)/i;
const PAID = new Set(['openai','anthropic','codex','claudeCode']);

export function providerConfiguration(selected, { env = process.env, allowedProviders = ['mock'] } = {}) {
  if (!selected?.provider || !allowedProviders.includes(selected.provider)) return { ok: false, reason: 'provider is not explicitly allowlisted' };
  if ((env.BLACKSPIRE_RUNTIME_MODE || 'mock') !== 'production' && PAID.has(selected.provider)) return { ok: false, reason: 'paid providers are forbidden outside production' };
  if (selected.provider === 'mock') return selected.mode === 'mock' ? { ok: true } : { ok: false, reason: 'mock provider mode is invalid' };
  const keyName = selected.provider === 'openai' ? 'OPENAI_API_KEY' : selected.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : selected.provider === 'codex' ? 'CODEX_API_KEY' : null;
  if (!keyName) return { ok: false, reason: 'provider configuration is unsupported' };
  const value = String(env[keyName] || '').trim();
  if (value.length < 20 || PLACEHOLDER.test(value)) return { ok: false, reason: 'provider credential is missing or invalid' };
  return { ok: true };
}

export function guardDispatch({ task: suppliedTask, workspace, actorId, channel, selected, deadline, idempotencyKey, allowedProviders = ['mock'], phase = 'provider' }) {
  const task = getTask(suppliedTask.id) || suppliedTask;
  const deny = (reason) => ({ ok: false, reason, phase });
  if (!task || !workspace) return deny('task or workspace missing');
  if (task.workspace_id !== workspace.id) return deny('workspace mismatch');
  if (task.actor_id && actorId !== undefined && String(actorId) !== String(task.actor_id)) return deny('actor mismatch');
  if (channel && channel !== (task.source_channel || 'api')) return deny('channel mismatch');
  const policy = evaluateRequestPolicy({ request: task.request, channel: task.source_channel || 'api', authority: task.authority_class || 'untrusted' });
  if (task.policy_decision === 'denied' || !policy.allowed) return deny('policy denial');
  if (getFlag('emergency_stop') === 'active') return deny('emergency stop active');
  if (task.status === 'cancelled') return deny('task cancelled');
  if (deadline && Date.parse(deadline) <= Date.now()) return deny('deadline expired');
  const spent = taskRecords(task.id).usage.reduce((sum, row) => sum + Number(row.cost_cents || 0), 0);
  if (!Number.isFinite(Number(task.budget_cents)) || Number(task.budget_cents) <= spent) return deny('budget exhausted or missing');
  if (phase === 'provider') {
    const configured = providerConfiguration(selected, { allowedProviders });
    if (!configured.ok) return deny(configured.reason);
    const duplicate = taskRecords(task.id).providerAttempts.some((row) => row.status === 'completed' && JSON.parse(row.request_packet || '{}').idempotencyKey === idempotencyKey);
    if (duplicate) return deny('duplicate replay');
  }
  return { ok: true, remainingBudgetCents: Number(task.budget_cents) - spent };
}
