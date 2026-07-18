import { id } from '../shared/util.js';
import { classifyRequest, evaluateRequestPolicy } from '../policy/policy.js';
import { guardDispatch } from '../execution/dispatchGuard.js';
import { DENIED_CAPABILITY_CLASSES } from '../hermes/contract.js';
import { audit, getTask, recordEvidence, recordProviderAttempt, transition } from '../task-engine/tasks.js';
import { runSubscriptionCodexWorker } from './adapter.js';

export async function runRestrictedCodexAcceptance({ task, workspace, actorId, worker = runSubscriptionCodexWorker, timeoutMs = 45_000 }) {
  const current = getTask(task.id) || task;
  const policy = evaluateRequestPolicy({ request: current.request, channel: current.source_channel || 'api', authority: current.authority_class || 'untrusted' });
  recordEvidence(current.id, 'policy_decision', { allowed: policy.allowed, actionClass: policy.actionClass });
  if (!policy.allowed || classifyRequest(current.request).privileged) return transition(current.id, 'failed', { error: 'Restricted Codex accepts low-risk objectives only' });
  const deadline = new Date(Date.now() + timeoutMs).toISOString();
  const guard = guardDispatch({ task: current, workspace, actorId, channel: current.source_channel || 'api', deadline, phase: 'hermes' });
  recordEvidence(current.id, guard.ok ? 'codex_dispatch_allowed' : 'codex_dispatch_prevented', { allowed: guard.ok, reason: guard.reason || 'guard passed' });
  if (!guard.ok) return transition(current.id, guard.reason === 'task cancelled' ? 'cancelled' : 'failed', { error: guard.reason });
  const request = { version:'1', requestId:id('codex'), canonicalConversationId:current.conversation_id || `task:${current.id}`, canonicalTaskId:current.id, actorId:String(actorId), workspaceId:workspace.id, channel:current.source_channel || 'api', objective:current.request, permittedCapabilityClasses:['status_summary'], deniedCapabilityClasses:[...DENIED_CAPABILITY_CLASSES], deadline, cancellationReference:`task:${current.id}:cancellation`, idempotencyKey:current.idempotency_key, invocationLimit:1 };
  transition(current.id, 'running', { current_stage:'restricted_codex_worker' });
  audit(current.id, 'hermes', 'codex_worker.selected', { worker:'codex-subscription', invocationLimit:1 });
  const result = await worker(request, { timeoutMs });
  if (getTask(current.id)?.status === 'cancelled') { recordEvidence(current.id, 'late_response_ignored', { worker:'codex-subscription' }); return getTask(current.id); }
  recordProviderAttempt(current.id, { provider:'codex-subscription', mode:'chatgpt-subscription', status:result.ok?'completed':'failed', requestPacket:{ requestId:request.requestId, idempotencyKey:request.idempotencyKey, deadline:request.deadline }, responsePacket:{ status:result.status, worker:result.worker, toolCalls:result.toolCalls }, error:result.error });
  recordEvidence(current.id, 'codex_worker_result', { worker:result.worker, authenticationMode:result.authenticationMode, invocationCount:result.invocationCount, toolCalls:result.toolCalls, status:result.status, contractValidated:result.ok });
  if (!result.ok) return transition(current.id, result.status === 'timeout' ? 'cancelled' : 'failed', { error:result.error });
  return transition(current.id, 'completed', { summary:{ result:result.result, worker:result.worker }, evidence:{ worker:result.worker, authenticationMode:result.authenticationMode } });
}
