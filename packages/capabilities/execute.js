import { blackspireCapabilityRegistry } from './index.js';
import { validateCapabilityInput, validateCapabilityOutput } from './contract.js';
import { createDivisionAdapters } from './http-adapters.js';
import { sellerOpportunityCapability, summarizeSellerOpportunities } from './seller-opportunities.js';
import { buyerProfilesCapability, summarizeBuyerProfiles } from './buyer-profiles.js';
import { buyerMatchesCapability, summarizeBuyerMatches } from './buyer-matches.js';
import { dealRecordsCapability, summarizeDealRecords } from './deal-records.js';
import { dealAnalysisCapability, summarizeDealAnalysis } from './deal-analysis.js';
import { resolveAdminBearer, requireWorkspacePermission } from '../shared/authorization.js';
import { audit, getFlag, getTask, prepareCapabilityDispatch, finishCapabilityDispatch, finalizeCapabilitySuccess, capabilityDispatchAuthority, recordEvidence, recordTaskEvent, transition, registerTaskAbortController, unregisterTaskAbortController } from '../task-engine/tasks.js';

function summarizeCapabilityResult(capability, result) {
  if (capability.id === 'buyer.profiles.search') return summarizeBuyerProfiles(result);
  if (capability.id === 'buyer.matches.search') return summarizeBuyerMatches(result);
  if (capability.id === 'deal.records.search') return summarizeDealRecords(result);
  if (capability.id === 'deal.analysis.get') return summarizeDealAnalysis(result);
  return summarizeSellerOpportunities(result);
}

function capabilityResultCount(capability, result) {
  if (capability.id === 'buyer.profiles.search') return Array.isArray(result?.profiles) ? result.profiles.length : 0;
  if (capability.id === 'buyer.matches.search') return Array.isArray(result?.matches) ? result.matches.length : 0;
  if (capability.id === 'deal.records.search') return Array.isArray(result?.deals) ? result.deals.length : 0;
  if (capability.id === 'deal.analysis.get') return result?.dealId ? 1 : 0;
  return Array.isArray(result?.opportunities) ? result.opportunities.length : 0;
}

export function selectCapabilityForTask(task, registry = blackspireCapabilityRegistry) {
  const objective = String(task?.request || '');
  const sellerMatch = /\b(?:seller|motivated[- ]seller)\b/i.test(objective) && /\b(?:opportunit(?:y|ies)|lead(?:s)?|propert(?:y|ies)|pipeline|best|rank|show|inspect|search)\b/i.test(objective);
  const buyerProfileMatch = /\b(?:buyer|buyers|buy)\b/i.test(objective) && /\b(?:profile|profiles|list|find|show|cash buyer)\b/i.test(objective) && !/\b(?:underwriting|analysis|MAO|ARV|repair|wholesale|deal rating)\b/i.test(objective);
  const buyerMatchMatch = /\b(?:buyer|buyers|buy)\b/i.test(objective) && /\b(?:match|matches|who would buy|for this deal|for this property)\b/i.test(objective);
  const dealAnalysisMatch = /\bdeal(?:s)?\b/i.test(objective) && /\b(?:underwriting|analysis|MAO|ARV|repair|wholesale|deal rating)\b/i.test(objective);
  const dealRecordsMatch = /\bdeal(?:s)?\b/i.test(objective) && /\b(?:list|search|show|active|all)\b/i.test(objective) && !dealAnalysisMatch;
  if (sellerMatch && !buyerProfileMatch && !buyerMatchMatch && !dealRecordsMatch && !dealAnalysisMatch) return registry.get('seller.opportunities.search');
  if (buyerMatchMatch) return registry.get('buyer.matches.search');
  if (buyerProfileMatch) return registry.get('buyer.profiles.search');
  if (dealAnalysisMatch) return registry.get('deal.analysis.get');
  if (dealRecordsMatch) return registry.get('deal.records.search');
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
    return transition(task.id, status, { error: reason, summary: null, current_stage: 'capability_prevented' }, ownership);
  };
  if (task.workspace_id !== workspace.id) return fail('capability workspace binding mismatch');
  if (!ownsTask(task.id, ownership)) return getTask(task.id);
  if (task.execution_intent !== capability.executionIntent) return fail('capability execution intent mismatch', 'failed');
  if (capability.approval !== 'none') return fail('capability approval was not satisfied', 'failed');
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
  let abortedBySignal = false;
  let cooperativeAbortHandled = false;
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', () => { abortedBySignal = true; controller.abort(); }, { once: true });
  const timer = setTimeout(() => { controller.abort(); }, capability.timeoutMs);
  registerTaskAbortController(task.id, controller);
  try {
    beforeAdapter?.();
    if (!ownsTask(task.id, ownership)) throw ownershipError();
    if (getFlag('emergency_stop') === 'active' || getTask(task.id)?.status === 'cancelled') throw cancellationError();
    recordTaskEvent(task.id, 'capability.dispatch_started', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
    const raw = await capability.execute({ task: getTask(task.id), workspace, principal, adapters, signal: controller.signal, taskRequest: task.request }, validatedInput);
    if (abortedBySignal) {
      recordEvidence(task.id, 'capability_late_response_ignored', { capabilityId: capability.id, attemptId: dispatch.attempt.id, reason: 'aborted_non_cooperative' });
      try { finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Non-cooperative adapter returned despite abort signal', responsePacket: { discarded: true } }); } catch { /* already terminal */ }
      const current = getTask(task.id);
      if (current?.status === 'cancelled') return current;
      if (!ownsTask(task.id, ownership)) return transition(task.id, 'failed', { error: 'Capability dispatch aborted; late result discarded', current_stage: 'cancelled' }, null);
      return transition(task.id, 'failed', { error: 'Capability dispatch aborted; late result discarded', current_stage: 'cancelled' }, ownership);
    }
    if (!ownsTask(task.id, ownership)) {
      finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability task ownership changed during dispatch' });
      recordEvidence(task.id, 'capability_ownership_lost', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
      return transition(task.id, 'failed', { error: 'Capability task ownership changed', current_stage: 'ownership_lost' }, null);
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
      recordEvidence(task.id, 'capability_authority_changed', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
      return fail('capability authority changed before result disclosure');
    }
    const result = validateCapabilityOutput(capability, raw);
    if (capabilityResultCount(capability, result) > (validatedInput._limit ?? validatedInput.limit ?? Infinity)) throw new Error('capability exceeded the requested result limit');
    const evidence = { capabilityId: capability.id, division: capability.division, readOnly: true, changedFiles: [], sourceSnapshotAt: result.sourceSnapshotAt, resultCount: capabilityResultCount(capability, result) };
    const summary = { result: summarizeCapabilityResult(capability, result), capabilityId: capability.id, division: capability.division, changedFiles: [], sourceSnapshotAt: result.sourceSnapshotAt };
    return finalizeCapabilitySuccess({ taskId: task.id, capabilityId: capability.id, workspaceId: workspace.id, principalId: task.actor_id, ownership, result, summary, evidence },
      (currentTask) => {
        const currentPrincipal = resolvePrincipal(currentTask.actor_id);
        return Boolean(currentPrincipal && capability.requiredPermissions.every((permission) => requireWorkspacePermission(currentPrincipal, workspace.id, permission).allowed));
      });
  } catch (error) {
    if (error?.code === 'CAPABILITY_OWNERSHIP_LOST') {
      finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability task ownership changed during dispatch' });
      recordEvidence(task.id, 'capability_ownership_lost', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
      return transition(task.id, 'failed', { error: 'Capability task ownership changed', current_stage: 'ownership_lost' }, null);
    }
    if (error?.code === 'CAPABILITY_CANCELLED' || getTask(task.id)?.status === 'cancelled' || getFlag('emergency_stop') === 'active') {
      try { finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability dispatch interrupted; outcome unknown' }); } catch (_) {}
      const current = getTask(task.id);
      if (current?.status === 'cancelled') return current;
      if (!ownsTask(task.id, ownership)) return transition(task.id, 'cancelled', { error: 'Capability execution cancelled', current_stage: 'cancelled' }, null);
      return transition(task.id, 'cancelled', { error: 'Capability execution cancelled', current_stage: 'cancelled' }, ownership);
    }
    if (error?.code === 'ABORTED' || (abortedBySignal && !cooperativeAbortHandled)) {
      finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability dispatch aborted; late result discarded' });
      recordEvidence(task.id, 'capability_late_response_ignored', { capabilityId: capability.id, attemptId: dispatch.attempt.id, reason: 'non_cooperative_abort' });
      return transition(task.id, 'failed', { error: 'Capability dispatch aborted; late result discarded', current_stage: 'cancelled' }, ownership);
    }
    finishCapabilityDispatch(task.id, capability.id, 'outcome_unknown', { error: 'Capability dispatch failed after start; outcome unknown' });
    recordEvidence(task.id, 'capability_outcome_unknown', { capabilityId: capability.id, attemptId: dispatch.attempt.id });
    return transition(task.id, 'outcome_unknown', { error: 'Capability dispatch outcome unknown; operator intervention required', current_stage: 'operator_intervention' }, ownership);
  } finally {
    clearTimeout(timer);
    unregisterTaskAbortController(task.id);
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
