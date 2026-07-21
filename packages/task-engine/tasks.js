import { id, now, redact } from '../shared/util.js';
import { query, execSql, esc, migrate } from './db.js';

migrate();

export function audit(taskId, actor, action, details = {}) {
  execSql(`INSERT INTO audit_events VALUES (${esc(id('aud'))},${esc(taskId)},${esc(actor)},${esc(action)},${esc(JSON.stringify(details))},${esc(now())});`);
}

export function createTask({ workspaceId, request, idempotencyKey, budgetCents = 500, conversationId = null, inputId = null, sourceChannel = null, actorId = null, actionClass = null, authorityClass = null, policyDecision = 'allowed', initialStatus = 'queued', initialError = null, initialSummary = null, initialEventType = null, initialEventPayload = {} }) {
  const existing = idempotencyKey && query(`SELECT * FROM tasks WHERE idempotency_key=${esc(idempotencyKey)};`)[0];
  if (existing) return existing;
  const task = {
    id: id('task'), workspace_id: workspaceId, request, status: initialStatus, idempotency_key: idempotencyKey || id('idem'), provider: null,
    plan: null, summary: initialSummary, error: initialError, budget_cents: budgetCents, retry_count: 0, created_at: now(), updated_at: now(),
    worker_id: null, claimed_at: null, heartbeat_at: null, current_stage: null, evidence: null,
    conversation_id: conversationId, input_id: inputId, source_channel: sourceChannel, actor_id: actorId, action_class: actionClass, authority_class: authorityClass, policy_decision: policyDecision,
  };
  execSql(`INSERT INTO tasks(${Object.keys(task).join(',')}) VALUES (${Object.values(task).map(esc).join(',')});`);
  audit(task.id, 'system', 'task.created', { request, workspaceId, status: initialStatus, actionClass, authorityClass, policyDecision });
  recordTaskEvent(task.id, initialEventType || `task.${initialStatus}`, { status: initialStatus, sourceChannel, actionClass, ...initialEventPayload });
  return getTask(task.id);
}

export function getTask(taskId) {
  return query(`SELECT * FROM tasks WHERE id=${esc(taskId)};`)[0] || null;
}

export function listTasks() {
  return query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50;');
}

export function transition(taskId, status, patch = {}) {
  const current = getTask(taskId);
  if (current?.status === 'cancelled' && !['cancelled','failed','queued'].includes(status)) return current;
  const sets = [`status=${esc(status)}`, `updated_at=${esc(now())}`, ...Object.entries(patch).map(([key, value]) => `${key}=${esc(typeof value === 'string' ? value : JSON.stringify(value))}`)];
  execSql(`UPDATE tasks SET ${sets.join(',')} WHERE id=${esc(taskId)};`);
  audit(taskId, 'system', 'task.transition', { status, ...patch });
  recordTaskEvent(taskId, `task.${status}`, { status, summary: patch.summary || null, error: patch.error || null, currentStage: patch.current_stage || null });
  return getTask(taskId);
}

export function recordTaskEvent(taskId, type, payload = {}) {
  const task = getTask(taskId);
  if (!task?.conversation_id) return null;
  const eventId = id('event');
  const safePayload = JSON.parse(redact(JSON.stringify({ taskId, conversationId: task.conversation_id, type, ...payload })));
  execSql(`INSERT INTO task_events VALUES (${esc(eventId)},${esc(task.conversation_id)},${esc(taskId)},${esc(type)},${esc(JSON.stringify(safePayload))},${esc(now())});`);
  const bindings = query(`SELECT * FROM conversation_bindings WHERE conversation_id=${esc(task.conversation_id)} AND channel='telegram';`);
  for (const binding of bindings) {
    execSql(`INSERT OR IGNORE INTO channel_deliveries VALUES (${esc(id('delivery'))},${esc(eventId)},${esc(task.conversation_id)},'telegram',${esc(binding.channel_key)},'pending',0,'','',${esc(now())},${esc(now())});`);
  }
  return eventId;
}

export function conversationEvents(conversationId, after = '') {
  const where = after ? `AND (created_at > COALESCE((SELECT created_at FROM task_events WHERE id=${esc(after)}),'') OR (created_at=COALESCE((SELECT created_at FROM task_events WHERE id=${esc(after)}),'') AND id>${esc(after)}))` : '';
  return query(`SELECT * FROM task_events WHERE conversation_id=${esc(conversationId)} ${where} ORDER BY created_at,id;`).map((event) => ({ ...event, payload: JSON.parse(event.payload || '{}') }));
}

export function pendingDeliveries(limit = 20) {
  return query(`SELECT d.*,e.type,e.task_id,e.payload FROM channel_deliveries d JOIN task_events e ON e.id=d.event_id WHERE d.status='pending' AND (d.next_attempt_at='' OR datetime(d.next_attempt_at)<=datetime('now')) ORDER BY d.created_at LIMIT ${Number(limit)};`);
}

export function completeDelivery(deliveryId) {
  execSql(`UPDATE channel_deliveries SET status='delivered',updated_at=${esc(now())},last_error='' WHERE id=${esc(deliveryId)};`);
}

export function failDelivery(deliveryId, error, { maxAttempts = Number(process.env.TELEGRAM_OUTBOX_MAX_ATTEMPTS || 3), retrySeconds = Number(process.env.TELEGRAM_OUTBOX_RETRY_SECONDS || 30) } = {}) {
  const safe = redact(String(error || 'delivery failed'));
  const parsedAttempts = Number(maxAttempts);
  const parsedDelay = Number(retrySeconds);
  const boundedAttempts = Number.isFinite(parsedAttempts) ? Math.max(1, Math.floor(parsedAttempts)) : 3;
  const boundedDelay = Number.isFinite(parsedDelay) ? Math.max(0, Math.floor(parsedDelay)) : 30;
  execSql(`UPDATE channel_deliveries SET status=CASE WHEN attempts+1>=${boundedAttempts} THEN 'failed' ELSE 'pending' END,attempts=attempts+1,last_error=${esc(safe)},next_attempt_at=CASE WHEN attempts+1>=${boundedAttempts} THEN '' ELSE datetime('now','+${boundedDelay} seconds') END,updated_at=${esc(now())} WHERE id=${esc(deliveryId)};`);
  return query(`SELECT * FROM channel_deliveries WHERE id=${esc(deliveryId)};`)[0] || null;
}

export function deliveryRecords(conversationId) {
  return query(`SELECT * FROM channel_deliveries WHERE conversation_id=${esc(conversationId)} ORDER BY created_at;`);
}

export function claimNext({ workerId, staleAfterSeconds = 300 } = {}) {
  const claimedAt = now();
  const assignedWorkerId = workerId || id('worker');
  execSql(`BEGIN IMMEDIATE;
UPDATE tasks SET status='planning', worker_id=${esc(assignedWorkerId)}, claimed_at=${esc(claimedAt)}, heartbeat_at=${esc(claimedAt)}, updated_at=${esc(claimedAt)}, current_stage='claimed'
WHERE id=(
  SELECT id FROM tasks
  WHERE status='queued' OR (status IN ('planning','running','validating') AND (heartbeat_at IS NULL OR datetime(heartbeat_at) < datetime('now','-${Number(staleAfterSeconds)} seconds')))
  ORDER BY created_at LIMIT 1
);
COMMIT;`);
  return query(`SELECT * FROM tasks WHERE claimed_at=${esc(claimedAt)} AND worker_id=${esc(assignedWorkerId)} ORDER BY created_at LIMIT 1;`)[0] || null;
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
  execSql(`INSERT INTO provider_attempts VALUES (${esc(id('attempt'))},${esc(taskId)},${esc(attempt.provider)},${esc(attempt.mode)},${esc(attempt.status)},${esc(redact(JSON.stringify(attempt.requestPacket || {})))},${esc(redact(JSON.stringify(attempt.responsePacket || {})))},${esc(redact(attempt.error || ''))},${Number(attempt.latencyMs || 0)},${esc(now())});`);
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
  execSql(`INSERT INTO task_evidence VALUES (${esc(id('ev'))},${esc(taskId)},${esc(kind)},${esc(redact(JSON.stringify(details)))},${esc(now())});`);
}


export function createApproval(taskId, action, reason, { riskLevel = 'high', requestedBy = 'hermes', expiresAt = null } = {}) {
  const existing = query(`SELECT * FROM approvals WHERE task_id=${esc(taskId)} AND action=${esc(action)} AND status='pending' ORDER BY created_at DESC LIMIT 1;`)[0];
  if (existing) return existing.id;
  const approvalId = id('approval');
  execSql(`INSERT INTO approvals VALUES (${esc(approvalId)},${esc(taskId)},${esc(action)},'pending',${esc(reason || '')},${esc(now())},NULL,${esc(riskLevel)},${esc(requestedBy)},NULL,NULL,${esc(expiresAt || '')});`);
  audit(taskId, 'policy', 'approval.created', { approvalId, action, reason, riskLevel, requestedBy, expiresAt });
  return approvalId;
}

// The most recent approval record for a task+action, regardless of status. Hermes uses this as the
// persisted "approved-action marker": once a decision is recorded here, re-running the task must not
// re-trigger the same approval prompt (that would loop forever on every resume).
export function latestApproval(taskId, action) {
  return query(`SELECT * FROM approvals WHERE task_id=${esc(taskId)} AND action=${esc(action)} ORDER BY created_at DESC LIMIT 1;`)[0] || null;
}

export function decideApproval(taskId, status, reason = '', { decidedBy = 'administrator' } = {}) {
  const approval = query(`SELECT * FROM approvals WHERE task_id=${esc(taskId)} AND status='pending' ORDER BY created_at DESC LIMIT 1;`)[0];
  if (!approval) {
    audit(taskId, 'administrator', `approval.${status}.idempotent`, { reason });
    return null;
  }
  if (approval.expires_at && Date.parse(approval.expires_at) < Date.now()) {
    execSql(`UPDATE approvals SET status='expired', decided_at=${esc(now())}, decided_by=${esc(decidedBy)}, decision_note='Expired before decision' WHERE id=${esc(approval.id)};`);
    audit(taskId, 'administrator', 'approval.expired', { reason: 'Expired before decision' });
    return 'expired';
  }
  execSql(`UPDATE approvals SET status=${esc(status)}, reason=${esc(approval.reason || reason)}, decided_at=${esc(now())}, decided_by=${esc(decidedBy)}, decision_note=${esc(reason)} WHERE id=${esc(approval.id)};`);
  audit(taskId, 'administrator', `approval.${status}`, { reason, decidedBy });
  return status;
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
