import { id, now } from '../shared/util.js';
import { query, execSql, esc, migrate } from './db.js';

migrate();

export function audit(taskId, actor, action, details = {}) {
  execSql(`INSERT INTO audit_events VALUES (${esc(id('aud'))},${esc(taskId)},${esc(actor)},${esc(action)},${esc(JSON.stringify(details))},${esc(now())});`);
}

export function createTask({ workspaceId, request, idempotencyKey, budgetCents = 500 }) {
  const existing = idempotencyKey && query(`SELECT * FROM tasks WHERE idempotency_key=${esc(idempotencyKey)};`)[0];
  if (existing) return existing;
  const task = {
    id: id('task'), workspace_id: workspaceId, request, status: 'queued', idempotency_key: idempotencyKey || id('idem'), provider: null,
    plan: null, summary: null, error: null, budget_cents: budgetCents, retry_count: 0, created_at: now(), updated_at: now(),
    worker_id: null, claimed_at: null, heartbeat_at: null, current_stage: null, evidence: null,
  };
  execSql(`INSERT INTO tasks VALUES (${Object.values(task).map(esc).join(',')});`);
  audit(task.id, 'system', 'task.created', { request, workspaceId });
  return getTask(task.id);
}

export function getTask(taskId) {
  return query(`SELECT * FROM tasks WHERE id=${esc(taskId)};`)[0] || null;
}

export function listTasks() {
  return query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50;');
}

export function transition(taskId, status, patch = {}) {
  const sets = [`status=${esc(status)}`, `updated_at=${esc(now())}`, ...Object.entries(patch).map(([key, value]) => `${key}=${esc(typeof value === 'string' ? value : JSON.stringify(value))}`)];
  execSql(`UPDATE tasks SET ${sets.join(',')} WHERE id=${esc(taskId)};`);
  audit(taskId, 'system', 'task.transition', { status, ...patch });
  return getTask(taskId);
}

export function claimNext({ workerId, staleAfterSeconds = 300 } = {}) {
  const claimedAt = now();
  execSql(`BEGIN IMMEDIATE;
UPDATE tasks SET status='planning', worker_id=${esc(workerId || id('worker'))}, claimed_at=${esc(claimedAt)}, heartbeat_at=${esc(claimedAt)}, updated_at=${esc(claimedAt)}, current_stage='claimed'
WHERE id=(
  SELECT id FROM tasks
  WHERE status='queued' OR (status IN ('planning','running','validating') AND (heartbeat_at IS NULL OR datetime(heartbeat_at) < datetime('now','-${Number(staleAfterSeconds)} seconds')))
  ORDER BY created_at LIMIT 1
);
COMMIT;`);
  return query(`SELECT * FROM tasks WHERE claimed_at=${esc(claimedAt)} ORDER BY created_at LIMIT 1;`)[0] || null;
}

export function heartbeat(taskId, stage) {
  execSql(`UPDATE tasks SET heartbeat_at=${esc(now())}, current_stage=${esc(stage || '')}, updated_at=${esc(now())} WHERE id=${esc(taskId)};`);
}

export function createSubtasks(taskId, subtasks) {
  execSql(subtasks.map((subtask) => `INSERT INTO subtasks VALUES (${esc(id('sub'))},${esc(taskId)},${esc(subtask.title)},${esc(subtask.status || 'queued')},${esc(subtask.stage)},${esc(JSON.stringify(subtask.details || {}))},${esc(now())},${esc(now())});`).join('\n'));
}

export function updateSubtask(taskId, stage, status, details = {}) {
  execSql(`UPDATE subtasks SET status=${esc(status)}, details=${esc(JSON.stringify(details))}, updated_at=${esc(now())} WHERE task_id=${esc(taskId)} AND stage=${esc(stage)};`);
}

export function recordProviderAttempt(taskId, attempt) {
  execSql(`INSERT INTO provider_attempts VALUES (${esc(id('attempt'))},${esc(taskId)},${esc(attempt.provider)},${esc(attempt.mode)},${esc(attempt.status)},${esc(JSON.stringify(attempt.requestPacket || {}))},${esc(JSON.stringify(attempt.responsePacket || {}))},${esc(attempt.error || '')},${Number(attempt.latencyMs || 0)},${esc(now())});`);
}

export function recordUsage(taskId, usage) {
  execSql(`INSERT INTO provider_usage VALUES (${esc(id('usage'))},${esc(taskId)},${esc(usage.provider)},${esc(usage.mode)},${Number(usage.latencyMs || 0)},${Number(usage.inputTokens || 0)},${Number(usage.outputTokens || 0)},${Number(usage.costCents || 0)},${esc(now())});`);
}

export function recordChangedFile(taskId, file) {
  execSql(`INSERT INTO changed_files VALUES (${esc(id('chg'))},${esc(taskId)},${esc(file.path)},${esc(file.status || 'modified')},${Number(file.additions || 0)},${Number(file.deletions || 0)},${esc(now())});`);
}

export function recordCommandResult(taskId, result) {
  execSql(`INSERT INTO command_results VALUES (${esc(id('cmd'))},${esc(taskId)},${esc(result.command)},${esc(result.cwd)},${result.ok ? 1 : 0},${result.code === null || result.code === undefined ? 'NULL' : Number(result.code)},${esc(result.stdout || '')},${esc(result.stderr || '')},${Number(result.durationMs || 0)},${esc(now())});`);
}

export function recordEvidence(taskId, kind, details = {}) {
  execSql(`INSERT INTO task_evidence VALUES (${esc(id('ev'))},${esc(taskId)},${esc(kind)},${esc(JSON.stringify(details))},${esc(now())});`);
}


export function createApproval(taskId, action, reason) {
  const approvalId = id('approval');
  execSql(`INSERT INTO approvals VALUES (${esc(approvalId)},${esc(taskId)},${esc(action)},'pending',${esc(reason || '')},${esc(now())},NULL);`);
  audit(taskId, 'policy', 'approval.created', { approvalId, action, reason });
  return approvalId;
}

export function decideApproval(taskId, status, reason = '') {
  execSql(`UPDATE approvals SET status=${esc(status)}, reason=${esc(reason)}, decided_at=${esc(now())} WHERE task_id=${esc(taskId)} AND status='pending';`);
  audit(taskId, 'administrator', `approval.${status}`, { reason });
}

export function taskRecords(taskId) {
  return {
    logs: logs(taskId),
    subtasks: query(`SELECT * FROM subtasks WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
    providerAttempts: query(`SELECT * FROM provider_attempts WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
    usage: query(`SELECT * FROM provider_usage WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
    changedFiles: query(`SELECT * FROM changed_files WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
    commands: query(`SELECT * FROM command_results WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
    evidence: query(`SELECT * FROM task_evidence WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
    approvals: query(`SELECT * FROM approvals WHERE task_id=${esc(taskId)} ORDER BY created_at;`),
  };
}

export function logs(taskId) {
  return query(`SELECT * FROM audit_events WHERE task_id=${esc(taskId)} ORDER BY created_at;`);
}

export function setFlag(key, value) {
  execSql(`INSERT OR REPLACE INTO system_flags VALUES (${esc(key)},${esc(value)},${esc(now())});`);
}

export function getFlag(key) {
  return query(`SELECT value FROM system_flags WHERE key=${esc(key)};`)[0]?.value;
}
