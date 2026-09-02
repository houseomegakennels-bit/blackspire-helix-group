import { blackspireCapabilityRegistry } from './index.js';
import { validateCapabilityInput, validateCapabilityOutput } from './contract.js';
import { createDivisionAdapters } from './http-adapters.js';
import { summarizeSellerOpportunities } from './seller-opportunities.js';
import { resolveAdminBearer, requireWorkspacePermission } from '../shared/authorization.js';
import { audit, getFlag, getTask, prepareCapabilityDispatch, finishCapabilityDispatch, finalizeCapabilitySuccess, capabilityDispatchAuthority, recordEvidence, recordTaskEvent, transition } from '../task-engine/tasks.js';

export function selectCapabilityForTask(task, registry = blackspireCapabilityRegistry) {
  const objective = String(task?.request || '');
  if (/\b(?:seller|motivated[- ]seller)\b/i.test(objective) && /\b(?:opportunit(?:y|ies)|lead(?:s)?|propert(?:y|ies)|pipeline|best|rank|show|inspect|search)\b/i.test(objective)) {
    return registry.get('seller.opportunities.search');
  }
  return null;
}

export async function executeRegisteredCapability(task, workspace, {
  registry = blackspireCapabilityRegistry, adapters = createDivisionAdapters(), resolvePrincipal = resolveAdminBearer,
  signal = null, beforeAdapter = null, ownership = null,
} = {}) {
  const capability = selectCapabilityForTask(task, registry);
  if (!capability) return null;
  const fail = (reason, status = 'failed') => {
    recordEvidence(task.id, 'capability_prevented', { capabilityId: capability.id, reason });
    recordTaskEvent(task.id, 'capability.prevented', { capabilityId: capability.id, reason, status });
    return transition(task.id, status, { error: reason, current_stage: 'capability_prevented' }, ownership);
  };
  if (task.workspace_id !== workspace.id) return fail('capability workspace binding mismatch');
  if (!ownsTask(task.id, ownership)) return getTask(task.id);
  if (task.execution_intent !== capability.executionIntent) return fail('capability execution intent mismatch');
  if (capability.approval !== 'none') return fail('capability approval was not satisfied');
  if (getFlag('emergency_stop') === 'active' || getTask(task.id)?.status === 'cancelled') return fail('capability execution cancelled', 'cancelled');

  const principal = resolvePrincipal(task.actor_id);
  if (!principal) return fail('capability principal is unavailable');
  for (const permission of capability.requiredPermissions) {
    if (!requireWorkspacePermission(principal, workspace.id, permission).allowed) return fail('capability permission denied');
  }
  const validatedInput = validateCapabilityInput(capability, { limit: 5 });
  const dispatch = prepareCapabilityDispatch(task.id, capability.id, {
    workspaceId: workspace.id, principalId: task.actor_id, ...capabilityDispatchAuthority(ownership), input: validatedInput,
  });
  if (!dispatch.owned) {
    if (['dispatching','started'].includes(dispatch.attempt.status)) {
      finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Prior capability dispatch outcome is unknown after recovery' });
    }
    recordEvidence(task.id, 'capability_replay_prevented', { capabilityId: capability.id, attemptId: dispatch.attempt.id, priorStatus: dispatch.attempt.status });
    return transition(task.id, 'outcome_unknown', { error: 'Capability dispatch outcome unknown; automatic replay refused', current_stage: 'operator_intervention' }, ownership);
  }

  audit(task.id, 'hermes', 'capability.selected', { capabilityId: capability.id, division: capability.division, workspaceId: workspace.id });
  recordTaskEvent(task.id, 'capability.selected', { capabilityId: capability.id, division: capability.division, executionIntent: capability.executionIntent });
  recordEvidence(task.id, 'capability_selection', { capabilityId: capability.id, division: capability.division, workspaceId: workspace.id, executionIntent: capability.executionIntent, requiredPermissions: capability.requiredPermissions, riskClass: capability.riskClass, approval: capability.approval });
  transition(task.id, 'running', { current_stage: 'capability_dispatch' }, ownership);

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, { once: true });
  const timer = setTimeout(abort, capability.timeoutMs);
  try {
    beforeAdapter?.();
    if (!ownsTask(task.id, ownership)) throw ownershipError();
    if (getFlag('emergency_stop') === 'active' || getTask(task.id)?.status === 'cancelled') throw cancellationError();
    recordTaskEvent(task.id, 'capability.dispatch_started', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
    const raw = await capability.execute({ task: getTask(task.id), workspace, principal, adapters, signal: controller.signal }, validatedInput);
    if (!ownsTask(task.id, ownership)) {
      finishCapabilityDispatch(task.id, capability.id, 'completed', { responsePacket: { discarded: true } });
      recordEvidence(task.id, 'capability_ownership_lost', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
      return getTask(task.id);
    }
    if (getFlag('emergency_stop') === 'active' || getTask(task.id)?.status === 'cancelled') {
      finishCapabilityDispatch(task.id, capability.id, 'completed', { responsePacket: { discarded: true } });
      recordEvidence(task.id, 'capability_late_response_ignored', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
      const current = getTask(task.id);
      return current?.status === 'cancelled' ? current : transition(task.id, 'cancelled', { error: 'Emergency stop active', current_stage: 'cancelled' }, ownership);
    }
    const currentPrincipal = resolvePrincipal(task.actor_id);
    if (!currentPrincipal || capability.requiredPermissions.some((permission) => !requireWorkspacePermission(currentPrincipal, workspace.id, permission).allowed)) {
      finishCapabilityDispatch(task.id, capability.id, 'completed', { responsePacket: { discarded: true } });
      return fail('capability authority changed before result disclosure');
    }
    const result = validateCapabilityOutput(capability, raw);
    if (result.opportunities.length > validatedInput.limit) throw new Error('Seller Engine capability exceeded the requested result limit');
    const evidence = { capabilityId: capability.id, division: capability.division, readOnly: true, changedFiles: [], sourceSnapshotAt: result.sourceSnapshotAt, resultCount: result.opportunities.length };
    const summary = { result: summarizeSellerOpportunities(result), capabilityId: capability.id, division: capability.division, changedFiles: [], sourceSnapshotAt: result.sourceSnapshotAt };
    return finalizeCapabilitySuccess({ taskId: task.id, capabilityId: capability.id, workspaceId: workspace.id, principalId: task.actor_id, ownership, result, summary, evidence },
      (currentTask) => {
        const currentPrincipal = resolvePrincipal(currentTask.actor_id);
        return Boolean(currentPrincipal && capability.requiredPermissions.every((permission) => requireWorkspacePermission(currentPrincipal, workspace.id, permission).allowed));
      });
  } catch (error) {
    if (error?.code === 'CAPABILITY_OWNERSHIP_LOST') {
      finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability task ownership changed during dispatch' });
      recordEvidence(task.id, 'capability_ownership_lost', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
      return getTask(task.id);
    }
    if (error?.code === 'CAPABILITY_CANCELLED' || controller.signal.aborted || getTask(task.id)?.status === 'cancelled' || getFlag('emergency_stop') === 'active') {
      finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability dispatch interrupted; outcome unknown' });
      return transition(task.id, 'cancelled', { error: 'Capability execution cancelled', current_stage: 'cancelled' }, ownership);
    }
    finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability dispatch failed after start; outcome unknown' });
    recordEvidence(task.id, 'capability_outcome_unknown', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
    return transition(task.id, 'outcome_unknown', { error: 'Capability dispatch outcome unknown; operator intervention required', current_stage: 'operator_intervention' }, ownership);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

function cancellationError() { const error = new Error('capability execution cancelled'); error.code = 'CAPABILITY_CANCELLED'; return error; }
function ownershipError() { const error = new Error('capability task ownership lost'); error.code = 'CAPABILITY_OWNERSHIP_LOST'; return error; }
function ownsTask(taskId, ownership) {
  if (!ownership) return true;
  const current = getTask(taskId);
  return Boolean(current && current.worker_id === ownership.workerId && current.claim_token === ownership.claimToken);
}
