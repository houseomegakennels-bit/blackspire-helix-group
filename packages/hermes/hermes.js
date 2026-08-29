import path from 'node:path';
import { transition, audit, getFlag, getTask, heartbeat, createSubtasks, updateSubtask, recordProviderAttempt, prepareCodexDispatch, finishCodexDispatchWithUsage, recordUsage, recordChangedFile, recordCommandResult, recordEvidence, createApproval, latestApproval, monetarySpend, recordTaskEvent } from '../task-engine/tasks.js';
import { getWorkspace } from '../workspace-registry/workspaces.js';
import { selectProvider, executeProviderRequest } from '../providers/providers.js';
import { runAllowed } from '../execution/runner.js';
import { classifyRequest, decide, evaluateRequestPolicy } from '../policy/policy.js';
import { createTaskBranch, applyEdits, artifactsWouldChangeWorkspace, inspectChangedFiles, commitArtifacts, createPullRequest, getRepositoryMetadata } from '../github/github.js';
import { query, esc } from '../task-engine/db.js';
import { createHermesRequest } from './contract.js';
import { dispatchHermes } from './adapter.js';
import { guardDispatch } from '../execution/dispatchGuard.js';
import { authorizeReadOnlyTestTask } from '../shared/testMode.js';

const STAGES = ['inspect_workspace', 'build_plan', 'decompose', 'select_provider', 'execute_provider', 'apply_edits', 'validate', 'commit', 'pull_request', 'summarize'];
const MAX_RETRIES = 2;
const HIGH_RISK_ACTION = 'high_risk_execution';

export async function processTask(task, { workerId = task.worker_id || null, claimToken = task.claim_token || null, dispatchHermesImpl = dispatchHermes } = {}) {
  const ownership = workerId && claimToken ? { workerId, claimToken } : null;
  const move = (status, patch = {}) => transition(task.id, status, patch, ownership);
  const workspace = getWorkspace(task.workspace_id);
  if (!workspace) return move('failed', { error: 'Workspace not found' });
  if (await shouldStop(task.id, ownership)) return;

  try {
    const authority = task.authority_class || (task.source_channel === 'telegram' ? 'telegram' : 'authenticated_admin');
    const ingress = evaluateRequestPolicy({ request: task.request, channel: task.source_channel || 'api', authority });
    if (task.policy_decision === 'denied' || !ingress.allowed) {
      recordEvidence(task.id, 'policy_denial', { reason: ingress.reason, actionClass: task.action_class || ingress.actionClass });
      recordTaskEvent(task.id, 'policy.denied', { status: 'failed', reason: ingress.reason, actionClass: task.action_class || ingress.actionClass });
      return move('failed', { error: ingress.reason, summary: 'Denied by Blackspire policy' });
    }
    const approval = evaluateApproval(task);
    if (approval.status === 'blocked') return move('failed', { error: approval.reason });
    if (approval.status === 'pending') {
      recordApprovalPause(task.id, approval.reason);
      return;
    }

    // Bounded mock acceptance path. Entering it is gated on the canonical
    // test-mode authorization (valid config + designated synthetic workspace +
    // mock-only policy), not on the raw env flag. If test mode is signalled but
    // the task is not a sanctioned bounded-mock case, fail closed — never let a
    // non-designated task reach either the mock completion or the real pipeline.
    if (process.env.UNIFIED_IPHONE_TEST_MODE === 'true') {
      const testAuth = authorizeReadOnlyTestTask(workspace);
      if (!testAuth.ok) {
        recordEvidence(task.id, 'mock_acceptance_denied', { reason: testAuth.reason });
        return move('failed', { error: `bounded mock acceptance path denied: ${testAuth.reason}` });
      }
      return processReadOnlyTestTask(task, workspace);
    }

    const actorId = taskActor(task);
    const hermesRequest = createHermesRequest({ task, actorId, workspace, permittedSkillToolClasses: workspace.enabled_tools || ['read','status'], timeoutMs: Number(process.env.HERMES_TIMEOUT_MS || 30_000) });
    const hermesGuard = guardDispatch({ task, workspace, actorId, channel: task.source_channel || 'api', deadline: hermesRequest.deadline, phase: 'hermes' });
    recordEvidence(task.id, hermesGuard.ok ? 'hermes_selection' : 'hermes_prevented', { allowed: hermesGuard.ok, reason: hermesGuard.reason || 'credential-free Hermes permitted', requestId: hermesRequest.requestId });
    if (!hermesGuard.ok) return move(hermesGuard.reason === 'task cancelled' ? 'cancelled' : 'failed', { error: hermesGuard.reason });
    const hermesResponse = await dispatchHermesImpl(hermesRequest, {
      allowedProviders: allowedProviders(workspace),
      shouldCancel: () => getFlag('emergency_stop') === 'active' || getTask(task.id)?.status === 'cancelled',
    });

    move('running', { current_stage: 'inspect_workspace' });
    const context = await stage(task.id, ownership, 'inspect_workspace', () => inspectWorkspace(workspace));
    const plan = await stage(task.id, ownership, 'build_plan', () => buildPlan(task, workspace, context));
    move('running', { plan });
    await stage(task.id, ownership, 'decompose', () => persistSubtasks(task.id, plan));
    const selected = await stage(task.id, ownership, 'select_provider', () => selectProvider(workspace.provider_policy, { requested: hermesResponse.provider, model: hermesResponse.model }));
    audit(task.id, 'hermes', 'provider.selected', selected);
    recordTaskEvent(task.id, 'provider.selected', { provider: selected.provider, mode: selected.mode });
    if (remainingBudget(task.id) <= 0) return move('failed', { error: 'Task budget exhausted before provider execution' });
    const providerResult = await providerWithRetries(task, workspace, selected, plan, context, hermesRequest, { workerId, claimToken });
    if (getTask(task.id)?.status === 'cancelled') return getTask(task.id);
    if (providerResult.ownershipLost) return getTask(task.id);
    if (!providerResult.ok) return move('failed', { error: providerResult.error || 'provider failed' });
    if (providerResult.handedOff) {
      const evidence = { provider: providerResult.provider, mode: providerResult.mode, manualPacketPath: providerResult.manualPacketPath, responseIngestionRequired: true };
      recordEvidence(task.id, 'manual_handoff_created', evidence);
      return move('waiting_for_manual_response', { evidence, current_stage: 'manual_handoff' });
    }
    if (task.execution_intent === 'workspace_mutation' && providerResult.artifacts.length === 0) {
      recordEvidence(task.id, 'artifact_application_refused', { reason: 'workspace mutation task returned no artifacts', provider: providerResult.provider });
      return move('failed', { error: 'Provider returned no artifacts for a workspace mutation task' });
    }
    if (task.execution_intent !== 'workspace_mutation' && providerResult.artifacts.length !== 0) {
      recordEvidence(task.id, 'artifact_application_refused', { reason: 'read-only task returned workspace artifacts', provider: providerResult.provider });
      return move('failed', { error: 'Provider returned workspace artifacts for a read-only task' });
    }
    if (task.execution_intent === 'read_only') {
      const evidence = { provider: providerResult.provider, mode: providerResult.mode, model: providerResult.model || null, changedFiles: [], readOnly: true };
      await stage(task.id, ownership, 'summarize', () => recordEvidence(task.id, 'final', evidence));
      return move('completed', { summary: { result: providerResult.summary || 'Read-only task completed', changedFiles: [], provider: providerResult.provider, model: providerResult.model || null }, evidence });
    }
    if (await shouldStop(task.id, ownership)) return;

    const branch = await stage(task.id, ownership, 'apply_edits', () => applyProviderEdits(task, workspace, providerResult));
    if (branch.changedFiles.length === 0) {
      recordEvidence(task.id, 'artifact_application_refused', { reason: 'workspace mutation task produced no workspace delta', provider: providerResult.provider });
      return move('failed', { error: 'Provider artifacts produced no workspace delta' });
    }
    const validation = await stage(task.id, ownership, 'validate', () => validateWorkspace(task.id, workspace));
    if (!validation.ok) return move('failed', { error: validation.stderr || 'validation failed', summary: { validation } });
    const commit = await stage(task.id, ownership, 'commit', () => commitArtifacts(`Hermes task ${task.id}: ${task.request.slice(0, 60)}`, providerResult.artifacts, { cwd: workspace.root_path, allowedPaths: workspace.allowed_paths }));
    if (!commit.ok) return move('failed', { error: commit.stderr || 'workspace mutation commit failed' });
    const pr = await stage(task.id, ownership, 'pull_request', () => createPullRequest({ title: `Hermes task ${task.id}`, body: `Automated Hermes task evidence for ${task.request}`, cwd: workspace.root_path, draft: true }));
    const evidence = { context, plan, provider: providerResult.provider, mode: providerResult.mode, branch, validation, commit, pullRequest: pr };
    await stage(task.id, ownership, 'summarize', () => recordEvidence(task.id, 'final', evidence));
    return move('completed', { summary: { result: 'completed', changedFiles: branch.changedFiles, validation, commit, pullRequest: pr }, evidence });
  } catch (error) {
    const result = move('failed', { error: error.message });
    if (result?.status === 'failed') audit(task.id, 'hermes', 'task.failed', { error: error.message });
    return result;
  }
}

async function processReadOnlyTestTask(task, workspace) {
  // This deliberately bounded path never applies artifacts.  A persisted
  // mutation intent must therefore fail before dispatch rather than reporting
  // a false mutation completion after discarding a mock artifact.
  if (task.execution_intent !== 'read_only') {
    recordEvidence(task.id, 'mock_acceptance_denied', { reason: 'bounded mock path supports read-only intent only' });
    return transition(task.id, 'failed', { error: 'bounded mock acceptance path supports read-only tasks only' });
  }
  const actorId = taskActor(task);
  const request = createHermesRequest({ task, actorId, workspace, permittedSkillToolClasses: ['read','status'] });
  const hermesGuard = guardDispatch({ task, workspace, actorId, channel: task.source_channel || 'api', deadline: request.deadline, phase: 'hermes' });
  if (!hermesGuard.ok) return transition(task.id, 'failed', { error: hermesGuard.reason });
  const hermes = await dispatchHermes(request, { allowedProviders: ['mock'] });
  transition(task.id, 'running', { current_stage: 'mock_status' });
  const selected = selectProvider({ preferred: ['mock'] }, { requested: hermes.provider, model: hermes.model });
  audit(task.id, 'hermes', 'provider.selected', selected);
  recordTaskEvent(task.id, 'provider.selected', selected);
  if (remainingBudget(task.id) <= 0) return transition(task.id, 'failed', { error: 'Task budget exhausted before provider execution' });
  const started = Date.now();
  const guard = guardDispatch({ task, workspace, actorId, channel: task.source_channel || 'api', selected, deadline: request.deadline, idempotencyKey: request.idempotencyKey, allowedProviders: ['mock'] });
  if (!guard.ok) return transition(task.id, guard.reason === 'task cancelled' ? 'cancelled' : 'failed', { error: guard.reason });
  const packet = { taskId: task.id, request: request.objective, executionIntent: task.execution_intent, idempotencyKey: request.idempotencyKey, deadline: request.deadline, cancellationReference: request.cancellationReference };
  const result = await executeProviderRequest({ selected, packet, workspace: null, deadline: request.deadline });
  if (getTask(task.id)?.status === 'cancelled') { recordEvidence(task.id, 'late_response_ignored', { provider: result.provider }); return getTask(task.id); }
  recordProviderAttempt(task.id, { provider: result.provider, mode: result.mode, status: result.ok ? 'completed' : 'failed', requestPacket: packet, responsePacket: { summary: result.summary, model: result.model }, error: result.error, latencyMs: Date.now() - started });
  recordUsage(task.id, result.usage);
  if (!result.ok) return transition(task.id, 'failed', { error: result.error || 'mock provider failed' });
  if (result.artifacts.length !== 0) {
    recordEvidence(task.id, 'artifact_application_refused', { reason: 'read-only bounded mock returned workspace artifacts', provider: result.provider });
    return transition(task.id, 'failed', { error: 'Read-only bounded mock returned workspace artifacts' });
  }
  const evidence = { provider: result.provider, mode: result.mode, model: result.model, changedFiles: [], readOnly: true };
  recordEvidence(task.id, 'final', evidence);
  return transition(task.id, 'completed', { summary: { result: result.summary || 'Read-only task completed', changedFiles: [], provider: result.provider, model: result.model }, evidence });
}

async function stage(taskId, ownership, name, fn) {
  if (await shouldStop(taskId, ownership)) throw new Error('Task stopped');
  if (ownership && !heartbeat(taskId, name, ownership)) throw new Error('Task claim ownership lost');
  if (!ownership) heartbeat(taskId, name);
  updateSubtask(taskId, name, 'running');
  audit(taskId, 'hermes', 'stage.started', { stage: name });
  const result = await fn();
  updateSubtask(taskId, name, 'completed', { result });
  audit(taskId, 'hermes', 'stage.completed', { stage: name });
  return result;
}

async function shouldStop(taskId, ownership = null) {
  if (getFlag('emergency_stop') === 'active') {
    transition(taskId, 'cancelled', { error: 'Emergency stop active' });
    return true;
  }
  const current = getTask(taskId);
  if (!current || current.status === 'cancelled') return true;
  if (ownership && (current.worker_id !== ownership.workerId || current.claim_token !== ownership.claimToken)) return true;
  return false;
}

function cancellationRequested(taskId) {
  if (getFlag('emergency_stop') === 'active') return true;
  const current = getTask(taskId);
  return !current || current.status === 'cancelled';
}

function requiresApproval(task) {
  const actionClass = task.action_class || classifyRequest(task.request).actionClass;
  return decide(actionClass).requiresApproval;
}

// Approvals are persisted state, not a per-run regex check: once an approval is recorded for a task,
// every subsequent run (resume, worker retry, etc.) reads that record instead of re-deciding from the
// request text. That is what stops an approved or rejected task from looping back into a fresh approval
// prompt every time it is picked up. A stale "approved" decision that outlived its own expiry window is
// treated as blocked, not clear, so the task cannot slip through on an approval that has gone cold.
function evaluateApproval(task) {
  if (!requiresApproval(task)) return { status: 'clear' };
  const approval = latestApproval(task.id, HIGH_RISK_ACTION);
  if (!approval) return { status: 'pending', reason: 'High-impact task requires administrator approval before execution' };
  if (approval.status === 'approved') {
    if (approval.expires_at && Date.parse(approval.expires_at) < Date.now()) return { status: 'blocked', reason: 'Approval expired before execution' };
    return { status: 'clear' };
  }
  if (approval.status === 'rejected') return { status: 'blocked', reason: 'Task was rejected by administrator' };
  if (approval.status === 'expired') return { status: 'blocked', reason: 'Approval expired before decision' };
  return { status: 'pending', reason: approval.reason || 'High-impact task requires administrator approval before execution' };
}

function recordApprovalPause(taskId, reason) {
  const expiresAt = new Date(Date.now() + Number(process.env.APPROVAL_TTL_MS || 30 * 60 * 1000)).toISOString();
  createSubtasks(taskId, [{ title: 'Approval required', stage: 'approval', status: 'waiting_for_approval', details: { reason } }]);
  createApproval(taskId, HIGH_RISK_ACTION, reason, { expiresAt });
  recordEvidence(taskId, 'approval_required', { reason });
  transition(taskId, 'waiting_for_approval', { summary: reason, current_stage: 'approval' });
}

function inspectWorkspace(workspace) {
  const repositoryPolicy = decide('repository', { repository: workspace.github_repository, allowlist: [workspace.github_repository] });
  if (!repositoryPolicy.allowed) throw new Error(repositoryPolicy.reason);
  const metadata = getRepositoryMetadata({ cwd: workspace.root_path });
  return { metadata, allowedPaths: workspace.allowed_paths, buildCommands: workspace.build_commands, root: path.resolve(workspace.root_path), changedFiles: inspectChangedFiles({ cwd: workspace.root_path }) };
}

function buildPlan(task, workspace, context) {
  return {
    taskId: task.id,
    goal: task.request,
    workspace: workspace.id,
    repository: workspace.github_repository,
    branch: `hermes/${task.id}`,
    stages: STAGES,
    validationCommands: workspace.build_commands,
    context,
  };
}

function persistSubtasks(taskId, plan) {
  createSubtasks(taskId, plan.stages.map((stageName) => ({ title: stageName.replaceAll('_', ' '), stage: stageName, status: 'queued' })));
  return { count: plan.stages.length };
}

async function providerWithRetries(task, workspace, selected, plan, context, hermesRequest, { workerId = null, claimToken = null } = {}) {
  let last;
  const maxAttempts = selected.provider === 'codex' ? 1 : MAX_RETRIES;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (remainingBudget(task.id) <= 0) return { ok: false, error: 'Task budget exhausted' };
    if (await shouldStop(task.id, workerId && claimToken ? { workerId, claimToken } : null)) return { ok: false, ownershipLost: getTask(task.id)?.status !== 'cancelled', error: 'cancelled or claim ownership lost' };
    const guard = guardDispatch({ task, workspace, actorId: taskActor(task), channel: task.source_channel || 'api', selected, deadline: hermesRequest.deadline, idempotencyKey: hermesRequest.idempotencyKey, allowedProviders: allowedProviders(workspace) });
    recordEvidence(task.id, guard.ok ? 'dispatch_attempt' : 'dispatch_prevented', { allowed: guard.ok, reason: guard.reason || 'guard passed', provider: selected.provider, attempt });
    if (!guard.ok) return { ok: false, error: guard.reason };
    const requestPacket = { taskId: task.id, request: hermesRequest.objective, executionIntent: task.execution_intent, attempt, idempotencyKey: hermesRequest.idempotencyKey, deadline: hermesRequest.deadline, cancellationReference: hermesRequest.cancellationReference, dispatchOwnership: workerId && claimToken ? { workerId, claimToken } : null };
    const started = Date.now();
    let codexDispatch = null;
    if (selected.provider === 'codex') {
      codexDispatch = prepareCodexDispatch(task.id, { mode: selected.mode, model: selected.model, requestPacket });
      if (!codexDispatch.owned) {
        if (['dispatching', 'started'].includes(codexDispatch.attempt.status)) finishCodexDispatchWithUsage(task.id, 'outcome_unknown', {
          attemptId: codexDispatch.attempt.id,
          responsePacket: { model: selected.model, accounting: { monetaryCostState: 'subscription_unmetered', costCents: null } },
          error: 'Prior Codex dispatch outcome is unknown after task recovery',
          usage: { provider: 'codex', mode: codexDispatch.attempt.mode, monetaryCostState: 'subscription_unmetered', costCents: null },
        });
        recordEvidence(task.id, 'codex_dispatch_replay_prevented', { attemptId: codexDispatch.attempt.id, priorStatus: codexDispatch.attempt.status });
        return { ok: false, error: 'Codex dispatch outcome unknown; operator intervention required; automatic replay refused' };
      }
      recordEvidence(task.id, 'codex_dispatch_started', { attemptId: codexDispatch.attempt.id, provider: 'codex', mode: selected.mode, attempt, idempotencyKey: hermesRequest.idempotencyKey });
    }
    const taskHeartbeatMs = Math.max(10, Number(process.env.HERMES_TASK_HEARTBEAT_INTERVAL_MS || 10_000));
    let leaseLost = false;
    const renewLease = () => {
      if (!workerId || !claimToken) return;
      if (!heartbeat(task.id, 'execute_provider', { workerId, claimToken })) {
        const current = getTask(task.id);
        if (current?.status !== 'cancelled') leaseLost = true;
      }
    };
    renewLease();
    if (leaseLost) return { ok: false, ownershipLost: true, error: 'worker claim ownership lost before provider dispatch' };
    const taskHeartbeat = setInterval(renewLease, taskHeartbeatMs);
    taskHeartbeat.unref?.();
    let result;
    try {
      result = await executeProviderRequest({ selected, packet: requestPacket, workspace, deadline: hermesRequest.deadline, shouldCancel: () => leaseLost || cancellationRequested(task.id) });
    } finally {
      clearInterval(taskHeartbeat);
    }
    if (workerId && claimToken && (getTask(task.id)?.worker_id !== workerId || getTask(task.id)?.claim_token !== claimToken)) leaseLost = true;
    if (leaseLost) {
      recordEvidence(task.id, 'codex_dispatch_ownership_lost', { attemptId: codexDispatch?.attempt?.id || null });
      return { ok: false, ownershipLost: true, error: 'worker claim ownership lost during provider dispatch' };
    }
    last = result;
    const responsePacket = { artifacts: result.artifacts, summary: result.summary, model: result.model, manualPacketPath: result.manualPacketPath, accounting: { monetaryCostState: result.usage?.monetaryCostState || null, costCents: result.usage?.costCents ?? null } };
    const usage = result.usage || { provider: result.provider, mode: result.mode };
    if (selected.provider === 'codex') finishCodexDispatchWithUsage(task.id, result.ok ? 'completed' : 'failed', { attemptId: codexDispatch.attempt.id, responsePacket, error: result.error, latencyMs: Date.now() - started, usage });
    else {
      recordProviderAttempt(task.id, { provider: result.provider, mode: result.mode, status: result.handedOff ? 'handed_off' : (result.ok ? 'completed' : 'failed'), requestPacket, responsePacket, error: result.error, latencyMs: Date.now() - started });
      recordUsage(task.id, usage);
    }
    if (getTask(task.id)?.status === 'cancelled') { recordEvidence(task.id, 'late_response_ignored', { provider: result.provider, attempt, dispatchStatus: result.ok ? 'completed' : 'failed' }); return { ok: false, error: 'cancelled' }; }
    if (result.ok) return result;
    transition(task.id, 'running', { retry_count: attempt });
  }
  return last;
}

function taskActor(task) {
  if (task.actor_id) return task.actor_id;
  if (!task.input_id) return task.authority_class || 'authenticated_admin';
  return query(`SELECT actor_id FROM unified_inputs WHERE id=${esc(task.input_id)};`)[0]?.actor_id || task.authority_class || 'untrusted';
}

function allowedProviders(workspace) {
  const preferred = workspace.provider_policy?.preferred || [];
  return preferred.filter((provider) => provider === 'mock' || process.env.BLACKSPIRE_RUNTIME_MODE === 'production');
}

function remainingBudget(taskId) {
  const task = getTask(taskId);
  return Number(task?.budget_cents || 0) - monetarySpend(taskId);
}

function applyProviderEdits(task, workspace, providerResult) {
  const currentWorkspaceChanges = inspectChangedFiles({ cwd: workspace.root_path });
  if (currentWorkspaceChanges.length !== 0) throw new Error('Workspace must be clean before applying provider artifacts');
  if (!artifactsWouldChangeWorkspace(providerResult.artifacts, { cwd: workspace.root_path, allowedPaths: workspace.allowed_paths })) throw new Error('Provider artifacts produced no workspace delta');
  const branchName = `hermes/${task.id}`;
  const branch = createTaskBranch(branchName, { cwd: workspace.root_path });
  if (!branch.ok) throw new Error(branch.stderr || 'failed to create task branch');
  const changed = applyEdits(providerResult.artifacts, { cwd: workspace.root_path, allowedPaths: workspace.allowed_paths });
  const inspected = inspectChangedFiles({ cwd: workspace.root_path });
  const filesToRecord = inspected;
  for (const file of filesToRecord) recordChangedFile(task.id, file);
  recordEvidence(task.id, 'branch', { branch: branchName, proposed: changed, changedFiles: filesToRecord });
  return { branch: branchName, changedFiles: filesToRecord };
}

async function validateWorkspace(taskId, workspace) {
  const command = workspace.build_commands[0];
  const policy = decide('command', { command, allowedCommands: workspace.build_commands });
  if (!policy.allowed && policy.requiresApproval) throw new Error(policy.reason);
  const result = await runAllowed(command, { cwd: workspace.root_path, allowedCommands: workspace.build_commands, timeoutMs: 120000 });
  recordCommandResult(taskId, result);
  audit(taskId, 'runner', 'command.finished', { command, ok: result.ok, code: result.code });
  return result;
}

export function createImprovementProposal(text) {
  return { type: 'self_improvement_proposal', status: 'backlog', text, requiresApproval: true };
}
