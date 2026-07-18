import path from 'node:path';
import { transition, audit, getFlag, getTask, heartbeat, createSubtasks, updateSubtask, recordProviderAttempt, recordUsage, recordChangedFile, recordCommandResult, recordEvidence, createApproval, latestApproval, taskRecords, recordTaskEvent } from '../task-engine/tasks.js';
import { getWorkspace } from '../workspace-registry/workspaces.js';
import { selectProvider, executeProviderRequest } from '../providers/providers.js';
import { runAllowed } from '../execution/runner.js';
import { decide } from '../policy/policy.js';
import { createTaskBranch, applyEdits, inspectChangedFiles, commitAll, createPullRequest, getRepositoryMetadata } from '../github/github.js';

const STAGES = ['inspect_workspace', 'build_plan', 'decompose', 'select_provider', 'execute_provider', 'apply_edits', 'validate', 'commit', 'pull_request', 'summarize'];
const MAX_RETRIES = 2;
const HIGH_RISK_ACTION = 'high_risk_execution';

export async function processTask(task) {
  const workspace = getWorkspace(task.workspace_id);
  if (!workspace) return transition(task.id, 'failed', { error: 'Workspace not found' });
  if (await shouldStop(task.id)) return;

  try {
    const approval = evaluateApproval(task);
    if (approval.status === 'blocked') return transition(task.id, 'failed', { error: approval.reason });
    if (approval.status === 'pending') {
      recordApprovalPause(task.id, approval.reason);
      return;
    }

    transition(task.id, 'running', { current_stage: 'inspect_workspace' });
    const context = await stage(task.id, 'inspect_workspace', () => inspectWorkspace(workspace));
    const plan = await stage(task.id, 'build_plan', () => buildPlan(task, workspace, context));
    transition(task.id, 'running', { plan });
    await stage(task.id, 'decompose', () => persistSubtasks(task.id, plan));
    const selected = await stage(task.id, 'select_provider', () => selectProvider(workspace.provider_policy));
    audit(task.id, 'hermes', 'provider.selected', selected);
    recordTaskEvent(task.id, 'provider.selected', { provider: selected.provider, mode: selected.mode });
    if (remainingBudget(task.id) <= 0) return transition(task.id, 'failed', { error: 'Task budget exhausted before provider execution' });
    const providerResult = await providerWithRetries(task, workspace, selected, plan, context);
    if (!providerResult.ok) return transition(task.id, 'failed', { error: providerResult.error || 'provider failed' });
    if (await shouldStop(task.id)) return;

    const branch = await stage(task.id, 'apply_edits', () => applyProviderEdits(task, workspace, providerResult));
    const validation = await stage(task.id, 'validate', () => validateWorkspace(task.id, workspace));
    if (!validation.ok) return transition(task.id, 'failed', { error: validation.stderr || 'validation failed', summary: { validation } });
    const commit = await stage(task.id, 'commit', () => commitAll(`Hermes task ${task.id}: ${task.request.slice(0, 60)}`, { cwd: workspace.root_path }));
    const pr = await stage(task.id, 'pull_request', () => createPullRequest({ title: `Hermes task ${task.id}`, body: `Automated Hermes task evidence for ${task.request}`, cwd: workspace.root_path, draft: true }));
    const evidence = { context, plan, provider: providerResult.provider, mode: providerResult.mode, branch, validation, commit, pullRequest: pr };
    await stage(task.id, 'summarize', () => recordEvidence(task.id, 'final', evidence));
    return transition(task.id, 'completed', { summary: { result: 'completed', changedFiles: branch.changedFiles, validation, commit, pullRequest: pr }, evidence });
  } catch (error) {
    audit(task.id, 'hermes', 'task.failed', { error: error.message });
    return transition(task.id, 'failed', { error: error.message });
  }
}

async function stage(taskId, name, fn) {
  if (await shouldStop(taskId)) throw new Error('Task stopped');
  heartbeat(taskId, name);
  updateSubtask(taskId, name, 'running');
  audit(taskId, 'hermes', 'stage.started', { stage: name });
  const result = await fn();
  updateSubtask(taskId, name, 'completed', { result });
  audit(taskId, 'hermes', 'stage.completed', { stage: name });
  return result;
}

async function shouldStop(taskId) {
  if (getFlag('emergency_stop') === 'active') {
    transition(taskId, 'cancelled', { error: 'Emergency stop active' });
    return true;
  }
  const current = getTask(taskId);
  if (!current || current.status === 'cancelled') return true;
  return false;
}

function requiresApproval(request) {
  return /deploy|delete|merge|billing|credential|trading|funds|production/i.test(request);
}

// Approvals are persisted state, not a per-run regex check: once an approval is recorded for a task,
// every subsequent run (resume, worker retry, etc.) reads that record instead of re-deciding from the
// request text. That is what stops an approved or rejected task from looping back into a fresh approval
// prompt every time it is picked up. A stale "approved" decision that outlived its own expiry window is
// treated as blocked, not clear, so the task cannot slip through on an approval that has gone cold.
function evaluateApproval(task) {
  if (!requiresApproval(task.request)) return { status: 'clear' };
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
  return { metadata, allowedPaths: workspace.allowed_paths, buildCommands: workspace.build_commands, root: path.resolve(workspace.root_path) };
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

async function providerWithRetries(task, workspace, selected, plan, context) {
  let last;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    if (remainingBudget(task.id) <= 0) return { ok: false, error: 'Task budget exhausted' };
    if (await shouldStop(task.id)) return { ok: false, error: 'cancelled' };
    const requestPacket = { taskId: task.id, request: task.request, plan, context, attempt };
    const started = Date.now();
    const result = await executeProviderRequest({ selected, packet: requestPacket, workspace });
    last = result;
    recordProviderAttempt(task.id, { provider: result.provider, mode: result.mode, status: result.ok ? 'completed' : 'failed', requestPacket, responsePacket: { artifacts: result.artifacts, summary: result.summary, manualPacketPath: result.manualPacketPath }, error: result.error, latencyMs: Date.now() - started });
    recordUsage(task.id, result.usage || { provider: result.provider, mode: result.mode });
    if (result.ok) return result;
    transition(task.id, 'running', { retry_count: attempt });
  }
  return last;
}

function remainingBudget(taskId) {
  const task = getTask(taskId);
  const spent = taskRecords(taskId).usage.reduce((sum, row) => sum + Number(row.cost_cents || 0), 0);
  return Number(task?.budget_cents || 0) - spent;
}

function applyProviderEdits(task, workspace, providerResult) {
  const branchName = `hermes/${task.id}`;
  const branch = createTaskBranch(branchName, { cwd: workspace.root_path });
  if (!branch.ok) throw new Error(branch.stderr || 'failed to create task branch');
  const changed = applyEdits(providerResult.artifacts, { cwd: workspace.root_path, allowedPaths: workspace.allowed_paths });
  const inspected = inspectChangedFiles({ cwd: workspace.root_path });
  const filesToRecord = inspected.length ? inspected : changed;
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
