import { id, now, redact } from '../shared/util.js';
import { query, execSql, esc, run, get, transaction } from './db.js';

export function audit(taskId, actor, action, details = {}) {
  execSql(`INSERT INTO audit_events VALUES (${esc(id('aud'))},${esc(taskId)},${esc(actor)},${esc(action)},${esc(JSON.stringify(details))},${esc(now())});`);
}

export function createTask({ workspaceId, request, idempotencyKey, budgetCents = 500, conversationId = null, inputId = null, sourceChannel = null, actorId = null, actionClass = null, authorityClass = null, policyDecision = 'allowed', executionIntent = 'workspace_mutation', initialStatus = 'queued', initialError = null, initialSummary = null, initialEventType = null, initialEventPayload = {} }) {
  if (!['read_only', 'workspace_mutation'].includes(executionIntent)) throw new Error('invalid task execution intent');
  const existing = idempotencyKey && query(`SELECT * FROM tasks WHERE idempotency_key=${esc(idempotencyKey)};`)[0];
  if (existing) return existing;
  const task = {
    id: id('task'), workspace_id: workspaceId, request, status: initialStatus, idempotency_key: idempotencyKey || id('idem'), provider: null,
    plan: null, summary: initialSummary, error: initialError, budget_cents: budgetCents, retry_count: 0, created_at: now(), updated_at: now(),
    worker_id: null, claim_token: null, claimed_at: null, heartbeat_at: null, current_stage: null, evidence: null,
    conversation_id: conversationId, input_id: inputId, source_channel: sourceChannel, actor_id: actorId, action_class: actionClass, authority_class: authorityClass, policy_decision: policyDecision, execution_intent: executionIntent,
  };
  execSql(`INSERT INTO tasks(${Object.keys(task).join(',')}) VALUES (${Object.values(task).map(esc).join(',')});`);
  audit(task.id, 'system', 'task.created', { request, workspaceId, status: initialStatus, actionClass, authorityClass, policyDecision, executionIntent });
  recordTaskEvent(task.id, initialEventType || `task.${initialStatus}`, { status: initialStatus, sourceChannel, actionClass, ...initialEventPayload });
  return getTask(task.id);
}

export function getTask(taskId) {
  return query(`SELECT * FROM tasks WHERE id=${esc(taskId)};`)[0] || null;
}

export function listTasks() {
  return query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50;');
}

export function transition(taskId, status, patch = {}, ownership = null) {
  const timestamp = now();
  const entries = Object.entries(patch);
  const sets = ['status=?', 'updated_at=?', ...entries.map(([key]) => `${key}=?`)];
  const values = [status, timestamp, ...entries.map(([, value]) => typeof value === 'string' ? value : JSON.stringify(value)), taskId];
  let predicate = status === 'cancelled' ? '' : " AND status<>'cancelled'";
  if (ownership) {
    predicate += ' AND worker_id=? AND claim_token=?';
    values.push(ownership.workerId, ownership.claimToken);
  }
  const result = run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?${predicate}`, values);
  const current = getTask(taskId);
  if (Number(result.changes) !== 1) return current;
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
  const claimToken = id('claim');
  execSql(`BEGIN IMMEDIATE;
UPDATE tasks SET status='planning', worker_id=${esc(assignedWorkerId)}, claim_token=${esc(claimToken)}, claimed_at=${esc(claimedAt)}, heartbeat_at=${esc(claimedAt)}, updated_at=${esc(claimedAt)}, current_stage='claimed'
WHERE id=(
  SELECT id FROM tasks
  WHERE status='queued' OR (status IN ('planning','running','validating') AND (heartbeat_at IS NULL OR datetime(heartbeat_at) < datetime('now','-${Number(staleAfterSeconds)} seconds')))
  ORDER BY created_at LIMIT 1
);
COMMIT;`);
  return query(`SELECT * FROM tasks WHERE claim_token=${esc(claimToken)} AND worker_id=${esc(assignedWorkerId)} LIMIT 1;`)[0] || null;
}

export function heartbeat(taskId, stage, { workerId = null, claimToken = null } = {}) {
  const timestamp = now();
  const result = workerId || claimToken
    ? run("UPDATE tasks SET heartbeat_at=?,current_stage=?,updated_at=? WHERE id=? AND worker_id=? AND claim_token=? AND status IN ('planning','running','validating')", [timestamp, stage || '', timestamp, taskId, workerId, claimToken])
    : run('UPDATE tasks SET heartbeat_at=?,current_stage=?,updated_at=? WHERE id=?', [timestamp, stage || '', timestamp, taskId]);
  return Number(result.changes) === 1;
}

export function createSubtasks(taskId, subtasks) {
  execSql(subtasks.map((subtask) => `INSERT INTO subtasks VALUES (${esc(id('sub'))},${esc(taskId)},${esc(subtask.title)},${esc(subtask.status || 'queued')},${esc(subtask.stage)},${esc(JSON.stringify(subtask.details || {}))},${esc(now())},${esc(now())});`).join('\n'));
}

export function updateSubtask(taskId, stage, status, details = {}) {
  execSql(`UPDATE subtasks SET status=${esc(status)}, details=${esc(JSON.stringify(details))}, updated_at=${esc(now())} WHERE task_id=${esc(taskId)} AND stage=${esc(stage)};`);
}

export function recordProviderAttempt(taskId, attempt) {
  const responsePacket = { ...(attempt.responsePacket || {}), accounting: attempt.accounting || attempt.responsePacket?.accounting || null };
  execSql(`INSERT INTO provider_attempts VALUES (${esc(id('attempt'))},${esc(taskId)},${esc(attempt.provider)},${esc(attempt.mode)},${esc(attempt.status)},${esc(redact(JSON.stringify(attempt.requestPacket || {})))},${esc(redact(JSON.stringify(responsePacket)))},${esc(redact(attempt.error || ''))},${Number(attempt.latencyMs || 0)},${esc(now())});`);
}

export function prepareCodexDispatch(taskId, attempt) {
  const attemptId = `codex_dispatch_${taskId}`;
  const responsePacket = { model: attempt.model || null, accounting: { monetaryCostState: 'subscription_unmetered', costCents: null } };
  return transaction(() => {
    const existing = get('SELECT * FROM provider_attempts WHERE id=? OR (task_id=? AND provider=\'codex\') ORDER BY created_at LIMIT 1', [attemptId, taskId]);
    if (existing) return { owned: false, attempt: existing };
    run('INSERT INTO provider_attempts(id,task_id,provider,mode,status,request_packet,response_packet,error,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [
      attemptId, taskId, 'codex', attempt.mode, 'dispatching', redact(JSON.stringify(attempt.requestPacket || {})), redact(JSON.stringify(responsePacket)), '', 0, now(),
    ]);
    return { owned: true, attempt: get('SELECT * FROM provider_attempts WHERE id=?', [attemptId]) };
  });
}

export function finishCodexDispatch(taskId, status, { attemptId = `codex_dispatch_${taskId}`, responsePacket = {}, error = '', latencyMs = 0 } = {}) {
  if (!['completed', 'failed', 'outcome_unknown'].includes(status)) throw new Error('invalid Codex dispatch terminal status');
  const result = run('UPDATE provider_attempts SET status=?,response_packet=?,error=?,latency_ms=? WHERE id=? AND status IN (\'dispatching\',\'started\')', [
    status, redact(JSON.stringify(responsePacket)), redact(error), Number(latencyMs || 0), attemptId,
  ]);
  if (Number(result.changes) !== 1) throw new Error('Codex dispatch attempt is missing or already terminal');
  return get('SELECT * FROM provider_attempts WHERE id=?', [attemptId]);
}

export function finishCodexDispatchWithUsage(taskId, status, { attemptId = `codex_dispatch_${taskId}`, responsePacket = {}, error = '', latencyMs = 0, usage, faultInjector = null } = {}) {
  return transaction(() => {
    const existing = get('SELECT * FROM provider_attempts WHERE id=?', [attemptId]);
    if (!existing || existing.task_id !== taskId || existing.provider !== 'codex' || existing.mode !== usage?.mode || usage?.provider !== 'codex') throw new Error('Codex dispatch identity mismatch');
    const existingUsage = get('SELECT * FROM provider_usage WHERE attempt_id=?', [attemptId]);
    const safeResponse = redact(JSON.stringify(responsePacket));
    const safeError = redact(error);
    if (existing.status === status && existingUsage && existing.response_packet === safeResponse && existing.error === safeError && Number(existing.latency_ms) === Number(latencyMs || 0)) return existing;
    if (!['dispatching', 'started'].includes(existing.status)) throw new Error('Codex dispatch attempt is already terminal');
    const attempt = finishCodexDispatch(taskId, status, { attemptId, responsePacket, error, latencyMs });
    faultInjector?.('after_attempt_update');
    recordUsage(taskId, { ...usage, attemptId });
    faultInjector?.('after_usage_insert');
    return attempt;
  });
}

export function recordUsage(taskId, usage) {
  const state = normalizeAccountingState(usage.monetaryCostState, usage.costCents);
  const cost = Number.isFinite(Number(usage.costCents)) && usage.costCents !== null && usage.costCents !== undefined ? Number(usage.costCents) : null;
  if (state === 'metered' && cost === null) throw new Error('metered provider usage requires a verified cost_cents value');
  run('INSERT INTO provider_usage(id,task_id,provider,mode,latency_ms,input_tokens,output_tokens,cost_cents,created_at,monetary_cost_state,accounting_metadata,attempt_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [
    usage.attemptId ? `usage_${usage.attemptId}` : id('usage'), taskId, usage.provider, usage.mode, Number(usage.latencyMs || 0), Number(usage.inputTokens || 0), Number(usage.outputTokens || 0), cost, now(), state, redact(JSON.stringify(usage.accountingMetadata || {})), usage.attemptId || null,
  ]);
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

export function monetarySpend(taskId) {
  return taskRecords(taskId).usage.reduce((sum, row) => {
    const state = row.monetary_cost_state || legacyAccountingState(row);
    if (state === 'metered') {
      if (row.cost_cents === null || row.cost_cents === undefined || row.cost_cents === '') throw new Error('metered provider usage has unknown cost');
      return sum + Number(row.cost_cents);
    }
    if (state === 'subscription_unmetered') return sum;
    if (state === 'metered_cost_unavailable') throw new Error('metered provider usage has unavailable cost');
    throw new Error(`unknown provider accounting state: ${state || 'missing'}`);
  }, 0);
}

function normalizeAccountingState(state, costCents) {
  const value = state || (costCents === null || costCents === undefined ? 'metered_cost_unavailable' : 'metered');
  if (['metered', 'subscription_unmetered', 'metered_cost_unavailable'].includes(value)) return value;
  return 'metered_cost_unavailable';
}

function legacyAccountingState(row) {
  if (row.provider === 'mock' || row.provider === 'manual') return 'metered';
  if (row.provider === 'codex' && row.mode === 'cli' && row.cost_cents === null) return 'subscription_unmetered';
  return row.cost_cents === null ? 'metered_cost_unavailable' : 'metered';
}
