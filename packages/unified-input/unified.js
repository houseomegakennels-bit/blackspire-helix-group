import { id, now, redact } from '../shared/util.js';
import { query, execSql, esc, migrate } from '../task-engine/db.js';
import { createTask, getTask, getFlag, transition, recordEvidence, recordTaskEvent, audit, conversationEvents, pendingDeliveries, completeDelivery, failDelivery, deliveryRecords, taskRecords } from '../task-engine/tasks.js';
import { getWorkspace } from '../workspace-registry/workspaces.js';

migrate();

const CHANNELS = new Set(['telegram', 'jarvis', 'api']);
const TELEGRAM_BLOCKED = /(?:\b(approve|reject|deploy|merge|credential|secret|token|password|api[ _-]?key|private\s+key|trade|trading|funds|budget\s+increase|increase\s+(?:the\s+)?budget|emergency\s+(?:stop|control)|reset\s+emergency|host\s+security|constitutional?|constitution|create\s+(?:a\s+)?repositor(?:y|ies)|repository\s+creation)\b|\.env\b)/i;
const ALWAYS_BLOCKED = /(?:\b(live\s+trad(?:e|ing)|send\s+funds|transfer\s+funds)\b|\b(show|read|print|expose|return)\b.{0,80}(?:\b(secret|credential|token|password|api[ _-]?key|private\s+key)\b|\.env\b))/i;
const cancellationTokens = new Map();

export function createUnifiedInput({ channel, actorId, channelKey, conversationId = null, workspaceId = 'blackspire-command', text, idempotencyKey, metadata = {} }) {
  if (!CHANNELS.has(channel)) return { error: 'unsupported channel', status: 422 };
  const request = String(text || '').trim();
  if (!request || request.length > 4000) return { error: 'request is required and must be under 4000 characters', status: 422 };
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return { error: 'workspace not found', status: 403 };
  if (getFlag('emergency_stop') === 'active') return { error: 'emergency stop active', status: 423 };

  const key = String(idempotencyKey || id('idem'));
  const duplicate = query(`SELECT i.*,t.id task_id,t.status task_status FROM unified_inputs i LEFT JOIN tasks t ON t.input_id=i.id WHERE i.channel=${esc(channel)} AND i.idempotency_key=${esc(key)};`)[0];
  if (duplicate) return responseFor(duplicate.conversation_id, duplicate.id, duplicate.task_id, duplicate.task_status, true);

  const conversation = resolveConversation({ conversationId, workspaceId, channel, channelKey, metadata });
  if (conversation.error) return conversation;
  const inputId = id('input');
  const denial = policyDenial(channel, request);
  execSql(`INSERT INTO unified_inputs VALUES (${esc(inputId)},${esc(conversation.id)},${esc(channel)},${esc(actorId || '')},${esc(redact(request))},${esc(key)},${esc(denial ? 'denied' : 'allowed')},${esc(now())});`);
  const task = createTask({ workspaceId, request: redact(request), idempotencyKey: `unified:${channel}:${key}`, budgetCents: Number(workspace.budget_cents || 0), conversationId: conversation.id, inputId, sourceChannel: channel });
  audit(task.id, channel, 'unified_input.accepted', { conversationId: conversation.id, inputId, channel, policy: denial ? 'denied' : 'allowed' });
  recordEvidence(task.id, 'unified_input', { conversationId: conversation.id, inputId, sourceChannel: channel, actorId: redact(String(actorId || '')), policy: denial ? 'denied' : 'allowed' });
  if (denial) {
    recordEvidence(task.id, 'policy_denial', { reason: denial });
    transition(task.id, 'failed', { error: denial, summary: 'Denied by Blackspire policy' });
  }
  return responseFor(conversation.id, inputId, task.id, denial ? 'failed' : task.status, false, denial);
}

function policyDenial(channel, request) {
  if (ALWAYS_BLOCKED.test(request)) return 'Request denied by Blackspire policy';
  if (channel === 'telegram' && TELEGRAM_BLOCKED.test(request)) return 'Telegram cannot perform privileged or prohibited actions';
  return null;
}

function resolveConversation({ conversationId, workspaceId, channel, channelKey, metadata }) {
  let conversation = conversationId && query(`SELECT * FROM conversations WHERE id=${esc(conversationId)};`)[0];
  if (conversationId && !conversation) return { error: 'conversation not found', status: 404 };
  if (conversation && conversation.workspace_id !== workspaceId) return { error: 'conversation workspace mismatch', status: 403 };
  if (!conversation && channelKey) {
    conversation = query(`SELECT c.* FROM conversations c JOIN conversation_bindings b ON b.conversation_id=c.id WHERE b.channel=${esc(channel)} AND b.channel_key=${esc(String(channelKey))};`)[0];
  }
  if (!conversation) {
    conversation = { id: id('conv'), workspace_id: workspaceId, status: 'active', created_at: now(), updated_at: now() };
    execSql(`INSERT INTO conversations VALUES (${Object.values(conversation).map(esc).join(',')});`);
  }
  if (channelKey) execSql(`INSERT OR IGNORE INTO conversation_bindings VALUES (${esc(id('binding'))},${esc(conversation.id)},${esc(channel)},${esc(String(channelKey))},${esc(JSON.stringify(sanitize(metadata)))},${esc(now())});`);
  return conversation;
}

export function getConversation(conversationId) {
  const conversation = query(`SELECT * FROM conversations WHERE id=${esc(conversationId)};`)[0];
  if (!conversation) return null;
  const tasks = query(`SELECT * FROM tasks WHERE conversation_id=${esc(conversationId)} ORDER BY created_at;`).map((task) => {
    const records = taskRecords(task.id);
    return {
      ...task,
      providerAttribution: records.providerAttempts.map(({ provider, mode, status, created_at }) => ({ provider, mode, status, created_at })),
      evidenceMetadata: records.evidence.map(({ id, kind, created_at }) => ({ id, kind, created_at })),
    };
  });
  return {
    conversation,
    messages: query(`SELECT id,conversation_id,channel,actor_id,text,policy_status,created_at FROM unified_inputs WHERE conversation_id=${esc(conversationId)} ORDER BY created_at,id;`),
    tasks,
    events: conversationEvents(conversationId),
    deliveries: deliveryRecords(conversationId),
  };
}

export function channelCanAccessConversation(channel, channelKey, conversationId) {
  return Boolean(query(`SELECT id FROM conversation_bindings WHERE conversation_id=${esc(conversationId)} AND channel=${esc(channel)} AND channel_key=${esc(String(channelKey))};`)[0]);
}

export function channelCanAccessTask(channel, channelKey, taskId) {
  const task = getTask(taskId);
  if (!task?.conversation_id) return false;
  return Boolean(query(`SELECT id FROM conversation_bindings WHERE conversation_id=${esc(task.conversation_id)} AND channel=${esc(channel)} AND channel_key=${esc(String(channelKey))};`)[0]);
}

export function cancelFromChannel(channel, channelKey, taskId) {
  if (!channelCanAccessTask(channel, channelKey, taskId)) return { error: 'task not found for channel', status: 404 };
  return requestCancellation(taskId, { actor: channel });
}

export function registerCancellationToken(taskId, token) {
  if (!token || typeof token.cancel !== 'function') throw new TypeError('cancellation token must provide cancel()');
  cancellationTokens.set(taskId, token);
  return () => cancellationTokens.delete(taskId);
}

export function requestCancellation(taskId, { actor = 'administrator' } = {}) {
  const task = getTask(taskId);
  if (!task) return { error: 'task not found', status: 404 };
  if (['completed', 'failed', 'cancelled'].includes(task.status)) return { task, cleanup: { invoked: false, reason: 'terminal task' } };
  audit(taskId, actor, 'cancellation_requested', { actor });
  recordTaskEvent(taskId, 'task.cancellation_requested', { status: task.status, actor });
  const token = cancellationTokens.get(taskId);
  let cleanup = { invoked: false, cleaned: true, reason: 'no active cancellation token' };
  try {
    if (token) cleanup = { invoked: true, cleaned: true, ...sanitize(token.cancel() || {}) };
  } catch (error) {
    cleanup = { invoked: true, cleaned: false, error: redact(error.message) };
  } finally {
    cancellationTokens.delete(taskId);
  }
  recordEvidence(taskId, 'cancellation_cleanup', cleanup);
  recordTaskEvent(taskId, 'task.cancellation_cleanup', cleanup);
  return { task: transition(taskId, 'cancelled', { error: `Cancelled from ${actor}` }), cleanup };
}

export async function drainTelegramOutbox(send, { limit = 20 } = {}) {
  const deliveries = pendingDeliveries(limit);
  const results = [];
  for (const delivery of deliveries) {
    const payload = JSON.parse(delivery.payload || '{}');
    const message = sanitizeEventMessage(delivery.type, delivery.task_id, payload);
    try {
      await send({ chatId: delivery.channel_key, text: [message] });
      completeDelivery(delivery.id);
      results.push({ id: delivery.id, status: 'delivered' });
    } catch (error) {
      const failed = failDelivery(delivery.id, error.message);
      results.push({ id: delivery.id, status: failed?.status || 'pending' });
    }
  }
  return results;
}

export function sanitizeEventMessage(type, taskId, payload) {
  const safe = sanitize(payload);
  return redact(`[${type}] ${taskId} ${safe.status || ''}${safe.summary ? `: ${typeof safe.summary === 'string' ? safe.summary : JSON.stringify(safe.summary)}` : ''}${safe.error ? `: ${safe.error}` : ''}`.trim());
}

function sanitize(value) {
  return JSON.parse(redact(JSON.stringify(value || {})));
}

function responseFor(conversationId, inputId, taskId, status, duplicate = false, denial = null) {
  return { conversationId, inputId, taskId, status, duplicate, ...(denial ? { error: denial, denied: true } : {}) };
}
