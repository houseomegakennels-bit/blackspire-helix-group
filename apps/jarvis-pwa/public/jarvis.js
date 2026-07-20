'use strict';
/* ============================================================
   Blackspire Jarvis — no-build command interface.
   Canonical backend state always wins; this file renders it.
   Security: dynamic data only ever becomes textContent.
   ============================================================ */

/* ---------- tiny DOM helpers ---------- */
const byId = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString();
};
const fmtDuration = (a, b) => {
  if (!a || !b) return '—';
  const ms = new Date(b) - new Date(a);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
};

/* ---------- status vocabulary (single source, color never alone) ---------- */
const STATUS = {
  queued: { label: 'Queued', tone: 'warn', core: 'processing' },
  running: { label: 'Processing', tone: 'ion', core: 'processing' },
  waiting_for_approval: { label: 'Awaiting approval', tone: 'warn', core: 'approval' },
  completed: { label: 'Completed', tone: 'ok', core: 'completed' },
  failed: { label: 'Failed', tone: 'bad', core: 'denied' },
  cancelled: { label: 'Cancelled', tone: 'muted', core: 'cancelled' },
};
const statusInfo = (task) => {
  if (!task) return { label: '—', tone: 'muted', core: 'dormant' };
  const base = STATUS[task.status] || { label: 'Unknown state', tone: 'muted', core: 'dormant' };
  if (task.status === 'failed' && task.policy_decision === 'denied') return { label: 'Denied by policy', tone: 'bad', core: 'denied' };
  return base;
};
const EVENT_LABELS = {
  'input.received': ['Input received', 'ion'],
  'policy.allowed': ['Policy allowed', 'ok'],
  'policy.denied': ['Policy denied', 'bad'],
  'task.created': ['Task created', 'ion'],
  'task.queued': ['Task queued', 'warn'],
  'task.running': ['Task processing', 'ion'],
  'task.waiting_for_approval': ['Awaiting approval', 'warn'],
  'hermes.selected': ['Hermes selected', 'ion'],
  'provider.selected': ['Provider selected', 'ion'],
  'task.completed': ['Task completed', 'ok'],
  'task.failed': ['Task failed', 'bad'],
  'task.cancellation_requested': ['Cancellation requested', 'warn'],
  'task.cancellation_cleanup': ['Cancellation cleanup', 'warn'],
  'task.cancelled': ['Task cancelled', 'muted'],
  'approval.required': ['Approval required', 'warn'],
  'approval.granted': ['Approval granted', 'ok'],
  'approval.denied': ['Approval denied', 'bad'],
  'delivery.pending': ['Delivery pending', 'warn'],
  'delivery.retry_wait': ['Delivery retry scheduled', 'warn'],
  'delivery.delivered': ['Delivered to channel', 'ok'],
  'delivery.terminal_failed': ['Delivery failed (terminal)', 'bad'],
};
/* Unknown event types must render safely and never crash. */
const eventLabel = (type) => EVENT_LABELS[type] || ['System event', 'muted'];

/* ---------- voice boundary (stub only — see JARVIS_VOICE_UI_CONTRACT.md) ----------
   States reserved for a future, separately authorized voice service:
   idle · listening · transcribing · processing · speaking · interrupted · denied · error.
   No speech API, provider, or microphone permission is used today. */
const voice = { state: 'idle' };

/* ---------- app state (memory only; refresh recovery via URL hash) ---------- */
const store = {
  authed: false, csrfToken: '',
  view: 'command', conversationId: '', taskId: '',
  conversation: null, tasks: [], workspaces: [],
  health: null, ready: null, testMode: null,
  offline: false, lastSync: null, pollMs: 2500, inflight: false,
  idemKey: '', announcedState: '', swWaiting: null, loading: false,
  workspaceTouched: false, refreshError: '', helix: null,
};
let selectedTaskId = '';

/* ---------- typed API layer ---------- */
/** @typedef {Object} UnifiedInputResponse
 * @property {string=} conversationId
 * @property {string=} taskId
 * @property {boolean=} duplicate
 * @property {boolean=} denied
 * @property {string=} error
 */
/** @typedef {Object} TaskRecord
 * @property {string} id
 * @property {string} status
 * @property {string=} conversation_id
 * @property {string=} workspace_id
 * @property {Array<Object>=} providerAttribution
 * @property {Array<Object>=} evidenceMetadata
 */
/** @typedef {Object} ConversationResponse
 * @property {Object=} conversation
 * @property {Array<Object>=} messages
 * @property {Array<Object>=} events
 * @property {Array<TaskRecord>=} tasks
 * @property {Array<Object>=} deliveries
 */
/** @typedef {Object} SystemHealth
 * @property {boolean=} ok
 * @property {boolean=} emergencyStop
 * @property {string=} telegramMode
 */
const api = {
  /** @template T @param {string} path @param {RequestInit=} options @returns {Promise<{response: Response, body: T}>} */
  async request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { 'content-type': 'application/json' };
    if (method !== 'GET' && store.csrfToken) headers['x-csrf-token'] = store.csrfToken;
    Object.assign(headers, options.headers || {});
    const response = await fetch(path, { method, credentials: 'same-origin', headers, body: options.body, signal: options.signal });
    let body = {};
    try { body = await response.json(); } catch { body = { error: 'Unexpected response from control plane' }; }
    if (response.status === 401 && store.authed) { store.authed = false; setNotice('sessionNotice', 'Session expired. Enter the admin token to continue.'); render(); }
    return { response, body };
  },
  session: () => api.request('/api/auth/session'),
  login: (adminToken) => api.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ adminToken }) }),
  logout: () => api.request('/api/auth/logout', { method: 'POST', body: '{}' }),
  health: (signal) => api.request('/health', { signal }),
  ready: (signal) => api.request('/ready', { signal }),
  testMode: (signal) => api.request('/api/test-mode', { signal }),
  workspaces: (signal) => api.request('/api/workspaces', { signal }),
  tasks: (signal) => api.request('/api/tasks', { signal }),
  task: (id, signal) => api.request('/api/tasks/' + encodeURIComponent(id), { signal }),
  taskApprovals: (id, signal) => api.request('/api/tasks/' + encodeURIComponent(id) + '/approvals', { signal }),
  /** @returns {Promise<{response: Response, body: ConversationResponse}>} */
  conversation: (id, signal) => api.request('/api/conversations/' + encodeURIComponent(id), { signal }),
  /** @returns {Promise<{response: Response, body: UnifiedInputResponse}>} */
  submitInput: (payload) => api.request('/api/unified-input', { method: 'POST', body: JSON.stringify(payload) }),
  cancelTask: (id) => api.request('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: '{}' }),
  approveTask: (id) => api.request('/api/tasks/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: '{}' }),
  rejectTask: (id) => api.request('/api/tasks/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: '{}' }),
  stop: () => api.request('/api/stop', { method: 'POST', body: '{}' }),
  stopReset: () => api.request('/api/stop/reset', { method: 'POST', body: '{}', headers: { 'x-confirmation-token': store.csrfToken + ':RESET' } }),
};

/* ---------- notices, toast, announcements ---------- */
function setNotice(id, text) { const node = byId(id); if (node) node.textContent = text || ''; }
let toastTimer = 0;
function toast(text) {
  const node = byId('toast');
  node.textContent = text; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}
function announce(text) { byId('announcer').textContent = text; }

/* ---------- router (hash keeps refresh recovery credential-free) ---------- */
const VIEWS = ['command', 'conversation', 'task', 'events', 'approvals', 'system', 'evidence'];
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS.includes(parts[0]) ? parts[0] : 'command';
  const id = parts[1] ? decodeURIComponent(parts[1]) : '';
  if (view === 'conversation' && id) store.conversationId = id;
  if (view === 'task' && id) { store.taskId = id; selectedTaskId = id; }
  store.view = view;
}
function go(view, id) { location.hash = '#/' + view + (id ? '/' + encodeURIComponent(id) : ''); }
window.addEventListener('hashchange', () => { parseHash(); refreshSoon(); render(); });

/* ---------- derived helpers ---------- */
const currentTask = () => {
  const list = (store.conversation?.tasks || []).filter(taskInActiveWorkspace);
  return list.find((t) => t.id === store.taskId) || list[list.length - 1] || store.tasks.filter(taskInActiveWorkspace).find((t) => t.id === store.taskId) || null;
};
const cancellable = (task) => Boolean(task && !['completed', 'failed', 'cancelled'].includes(task.status));
const latestAttribution = (task) => (task?.providerAttribution || []).slice(-1)[0] || null;
const activeWorkspaceId = () => byId('workspace')?.value || '';
function taskInActiveWorkspace(task) {
  const active = activeWorkspaceId();
  return Boolean(task && (!active || task.workspace_id === active));
}
function eventTime(taskId, ...types) {
  const events = store.conversation?.events || [];
  return events.find((event) => event.task_id === taskId && types.includes(event.type))?.created_at || '';
}

/* ---------- Helix Core state ---------- */
function coreStateFor() {
  if (store.health?.emergencyStop) return ['emergency', 'Emergency stop', 'Dispatch is frozen by the control plane.'];
  if (store.offline) return ['offline', 'Offline', 'No connection to the control plane.'];
  if (document.activeElement === byId('cmd') || document.activeElement === byId('followCmd')) return ['listening', 'Listening', 'Composing a command.'];
  const task = currentTask();
  if (task) {
    const info = statusInfo(task);
    const detail = { processing: 'Hermes is working within Blackspire constraints.', approval: 'A decision is required in the Approval center.', completed: 'Canonical state is stable.', denied: 'Blackspire policy locked this request.', cancelled: 'The orbit wound down safely.' }[info.core];
    return [info.core, info.label, detail || 'Awaiting your command.'];
  }
  return ['dormant', 'Dormant', 'Awaiting your command.'];
}
function renderCore() {
  const [core, label, detail] = coreStateFor();
  byId('helixCard').dataset.core = core;
  const tone = { emergency: 'bad', denied: 'bad', approval: 'warn', completed: 'ok', offline: 'muted', cancelled: 'muted' }[core] || 'ion';
  byId('coreState').dataset.tone = tone;
  byId('coreStateLabel').textContent = label;
  byId('coreDetail').textContent = detail;
  byId('coreSr').textContent = 'Helix Core state: ' + label;
  store.helix?.setState(core);
}

/* ---------- header status rail ---------- */
function badge(label, value, tone) {
  const b = el('span', 'badge', ''); b.dataset.tone = tone || '';
  b.append(el('span', 'dot'), document.createTextNode(label + value));
  return b;
}
function renderStatus(h) {
  const rail = byId('statusBar'); rail.replaceChildren();
  rail.append(badge('Link: ', store.offline ? 'offline' : 'online', store.offline ? 'bad' : 'ok'));
  if (h && !h.error) {
    rail.append(badge('Emergency stop: ', h.emergencyStop ? 'ACTIVE' : 'inactive', h.emergencyStop ? 'bad' : 'ok'));
    rail.append(badge('Telegram: ', h.telegramMode || 'unknown', 'ion'));
  }
  if (store.testMode?.enabled) rail.append(badge('Mode: ', 'TEST FIXTURE', 'warn'));
}

/* ---------- renderers ---------- */
function renderNav() {
  byId('viewNav').hidden = !store.authed;
  for (const link of byId('viewNav').querySelectorAll('a')) {
    const target = link.getAttribute('href').slice(2);
    if (target === store.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
function renderViews() {
  for (const section of document.querySelectorAll('section[data-view]')) {
    const name = section.dataset.view;
    section.hidden = store.authed ? name !== store.view : name !== 'signin';
  }
}

function taskStatePill(task) {
  const info = statusInfo(task);
  const pill = el('span', 'state'); pill.dataset.tone = info.tone;
  pill.append(el('span', 'dot'), el('span', null, info.label));
  return pill;
}

function renderCurrentTask() {
  const wrap = byId('currentTaskCard'); wrap.replaceChildren();
  const task = currentTask();
  if (!task) { wrap.append(el('p', 'empty', 'No task yet. Submit a command to create one.')); return; }
  wrap.append(taskStatePill(task));
  const req = el('p', null, task.request || '—'); req.style.fontSize = '14px';
  wrap.append(req);
  const ids = el('p', 'mono', 'task ' + task.id + (task.conversation_id ? ' · conversation ' + task.conversation_id : ''));
  ids.classList.add('stamp');
  wrap.append(ids);
  const open = el('button', 'ghost', 'Open task detail'); open.type = 'button';
  open.addEventListener('click', () => go('task', task.id));
  wrap.append(open);
}

function renderAttribution() {
  const wrap = byId('attributionCard'); wrap.replaceChildren();
  const task = currentTask();
  const conv = store.conversation;
  if (!task) { wrap.append(el('p', 'empty', 'Hermes, provider, and Telegram delivery attribution appear after dispatch.')); return; }
  const attr = latestAttribution(task);
  const facts = el('div', 'facts');
  const fact = (label, value) => {
    const f = el('div', 'fact');
    f.append(el('span', 'label', label), el('span', 'value mono', value ?? '—'));
    return f;
  };
  facts.append(
    fact('Hermes stage', task.current_stage || 'Not dispatched'),
    fact('Worker', task.worker_id || 'Unassigned'),
    fact('Provider', attr ? attr.provider + (attr.mode ? ' (' + attr.mode + ')' : '') : 'Not dispatched'),
    fact('Model', attr?.model || '—'),
  );
  wrap.append(facts);
  const deliveries = conv?.deliveries || [];
  if (deliveries.length) {
    const list = el('div', 'stack');
    list.append(el('h3', null, 'Telegram delivery'));
    for (const d of deliveries.slice(-4)) list.append(deliveryLine(d));
    wrap.append(list);
  } else {
    wrap.append(el('p', 'muted stamp', 'Telegram delivery: no channel bound to this conversation.'));
  }
}
function deliveryLine(d) {
  const line = el('p', 'state');
  const retrying = d.status === 'pending' && Number(d.attempts) > 0;
  const label = d.status === 'delivered' ? 'Delivered' : d.status === 'failed' ? 'Delivery failed (terminal)' : retrying ? 'Retrying delivery' : 'Delivery pending';
  line.dataset.tone = d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn';
  line.append(el('span', 'dot'), el('span', null, label + ' · attempts ' + (d.attempts ?? 0) + (retrying && d.next_attempt_at ? ' · next ' + fmtTime(d.next_attempt_at) : '')));
  return line;
}

function renderRecentConversations() {
  const wrap = byId('recentConversations'); wrap.replaceChildren();
  const seen = new Map();
  for (const task of store.tasks.filter(taskInActiveWorkspace)) {
    if (!task.conversation_id || seen.has(task.conversation_id)) continue;
    seen.set(task.conversation_id, task);
  }
  if (!seen.size) { wrap.append(el('p', 'empty', 'No conversations yet.')); return; }
  for (const [cid, task] of [...seen].slice(0, 6)) {
    const btn = el('button', 'ghost'); btn.type = 'button'; btn.style.textAlign = 'left';
    const line = el('span', null, (task.request || 'Conversation').slice(0, 90));
    const meta = el('span', 'stamp mono', cid + ' · ' + fmtTime(task.created_at));
    btn.append(line, document.createElement('br'), meta);
    btn.addEventListener('click', () => { store.taskId = task.id; selectedTaskId = task.id; go('conversation', cid); });
    wrap.append(btn);
  }
}

function renderConversation() {
  const conv = store.conversation;
  const firstMessage = conv?.messages?.[0]?.text || '';
  byId('convTitle').textContent = firstMessage ? 'Conversation · ' + firstMessage.slice(0, 54) : 'Conversation';
  byId('convId').textContent = store.conversationId || '—';
  byId('convWorkspace').textContent = conv?.conversation?.workspace_id || '—';
  byId('convSync').textContent = store.loading ? 'refreshing…' : store.refreshError ? 'stale · reconnecting' : store.lastSync ? 'synced ' + fmtTime(store.lastSync) : '—';
  const list = byId('messageList'); list.replaceChildren();
  const messages = conv?.messages || [];
  byId('messagesEmpty').hidden = messages.length > 0;
  messages.forEach((m, i) => {
    const li = el('li'); li.style.setProperty('--i', String(Math.min(i, 8)));
    const chip = el('span', 'chip', m.channel || 'jarvis'); chip.dataset.ch = m.channel || 'jarvis';
    li.append(chip);
    if (m.policy_status === 'denied') { const d = el('span', 'chip', 'denied'); d.dataset.ch = 'denied'; li.append(document.createTextNode(' '), d); }
    li.append(el('p', null, m.text || ''), el('span', 'stamp', fmtTime(m.created_at)));
    list.append(li);
  });
}

function renderTaskDetail() {
  const task = currentTask();
  const set = (id, value) => { byId(id).textContent = (value === undefined || value === null || value === '') ? '—' : String(value); };
  set('taskIdValue', task?.id);
  selectedTaskId = task?.id || selectedTaskId;
  const info = statusInfo(task);
  byId('taskStatePill').dataset.tone = info.tone;
  byId('taskStateLabel').textContent = info.label;
  set('taskWorkspace', task?.workspace_id);
  set('taskRisk', task?.action_class);
  set('taskAuthority', task?.authority_class);
  set('taskStage', task?.current_stage || (task ? 'Not dispatched' : null));
  set('taskHermesSkill', task?.hermes_skill || (task ? 'Not reported by control plane' : null));
  set('taskWorker', task?.worker_id || (task ? 'Unassigned' : null));
  const attr = latestAttribution(task);
  set('taskProvider', attr ? attr.provider + (attr.model ? ' / ' + attr.model : attr.mode ? ' / ' + attr.mode : '') : null);
  set('taskBudget', task?.budget_cents != null ? task.budget_cents + '¢' : null);
  const startedAt = task ? eventTime(task.id, 'task.running') || task.created_at : '';
  const completedAt = task ? eventTime(task.id, 'task.completed', 'task.failed', 'task.cancelled') : '';
  set('taskStarted', startedAt ? fmtTime(startedAt) : null);
  set('taskCompleted', completedAt ? fmtTime(completedAt) : null);
  set('taskUpdated', task ? fmtTime(task.updated_at) : null);
  set('taskDuration', task && completedAt ? fmtDuration(startedAt, completedAt) : null);
  set('taskIdem', task?.idempotency_key);
  set('taskRequest', task?.request);
  let outcome = '—';
  if (task?.error) outcome = String(task.error);
  else if (task?.summary) { try { const s = JSON.parse(task.summary); outcome = s.result || task.summary; } catch { outcome = String(task.summary); } }
  set('taskOutcome', outcome);
  byId('cancelBtn').disabled = !cancellable(task);
  renderTaskEvidence(task);
}

function renderTaskEvidence(task) {
  const wrap = byId('taskEvidence'); wrap.replaceChildren();
  if (!task) { wrap.append(el('p', 'empty', 'No evidence recorded yet.')); return; }
  const kinds = (task.evidenceMetadata || []).map((e) => e.kind);
  if (kinds.length) {
    const row = el('div', 'row');
    for (const kind of kinds) row.append(el('span', 'chip', kind));
    wrap.append(row);
  } else {
    wrap.append(el('p', 'muted stamp', 'Evidence summary appears once the control plane records it.'));
  }
  const conv = store.conversation;
  const deliveries = (conv?.deliveries || []);
  if (deliveries.length) { wrap.append(el('h3', null, 'Delivery / outbox')); for (const d of deliveries.slice(-4)) wrap.append(deliveryLine(d)); }
  wrap.append(el('p', 'muted stamp', 'Replay protection: idempotency key ' + (task.idempotency_key || '—')));
}

function renderEvents() {
  const list = byId('eventList'); list.replaceChildren();
  const events = store.conversation?.events || [];
  byId('eventsEmpty').hidden = events.length > 0;
  events.forEach((event, i) => {
    const [label, tone] = eventLabel(event.type);
    const li = el('li'); li.dataset.tone = tone; li.style.setProperty('--i', String(Math.min(i, 8)));
    li.append(el('span', 'etype', label));
    const meta = el('span', 'stamp mono', String(event.type) + (event.task_id ? ' · ' + event.task_id : ''));
    li.append(meta);
    const payload = event.payload || {};
    const note = payload.reason || payload.error || payload.summary || payload.currentStage || '';
    if (note && typeof note === 'string') li.append(el('span', 'stamp', note));
    li.append(el('time', null, fmtTime(event.created_at)));
    list.append(li);
  });
}

async function renderApprovals() {
  const wrap = byId('approvalList'); wrap.replaceChildren();
  const pending = store.tasks.filter(taskInActiveWorkspace).filter((t) => t.status === 'waiting_for_approval');
  if (!pending.length) { wrap.append(el('p', 'empty', 'No approvals pending.')); return; }
  for (const task of pending.slice(0, 8)) {
    const card = el('div', 'panel raised stack');
    card.append(taskStatePill(task));
    card.append(el('p', null, task.request || '—'));
    const facts = el('p', 'stamp mono', 'task ' + task.id + ' · workspace ' + (task.workspace_id || '—') + ' · risk ' + (task.action_class || '—'));
    card.append(facts);
    const why = el('p', 'muted stamp', taskExplanation(task));
    card.append(why);
    const expiry = el('p', 'stamp mono', '');
    card.append(expiry);
    api.taskApprovals(task.id).then(({ body }) => {
      const open = (body.approvals || []).find((a) => a.status === 'pending');
      if (open?.expires_at) expiry.textContent = 'expires ' + fmtTime(open.expires_at);
      if (open?.reason) why.textContent = open.reason;
    }).catch(() => {});
    const row = el('div', 'row');
    const approve = el('button', 'primary', 'Approve'); approve.type = 'button';
    const reject = el('button', 'danger', 'Reject'); reject.type = 'button';
    approve.addEventListener('click', () => decideApprovalAction(task.id, 'approve', approve, reject));
    reject.addEventListener('click', () => decideApprovalAction(task.id, 'reject', approve, reject));
    row.append(approve, reject);
    card.append(row);
    wrap.append(card);
  }
}
function taskExplanation(task) {
  if (task.summary) { try { return JSON.parse(task.summary).result || String(task.summary); } catch { return String(task.summary); } }
  return 'The control plane requires administrator approval before execution.';
}
async function decideApprovalAction(taskId, action, ...buttons) {
  buttons.forEach((b) => { b.disabled = true; });
  const { response, body } = action === 'approve' ? await api.approveTask(taskId) : await api.rejectTask(taskId);
  if (!response.ok) { toast(body.error || 'The control plane declined this decision.'); buttons.forEach((b) => { b.disabled = false; }); return; }
  const canonicalStatus = body.task?.status || body.status || 'recorded';
  toast('Control plane response: ' + canonicalStatus + '. Refreshing canonical state.');
  await refreshAll();
}

function renderSystem() {
  const h = store.health; const r = store.ready;
  byId('sysApi').textContent = h?.ok ? 'Healthy' : store.offline ? 'Unreachable' : '—';
  byId('sysLink').textContent = store.offline ? 'Offline — reconnecting with backoff' : 'Connected';
  byId('sysStop').textContent = h ? (h.emergencyStop ? 'ACTIVE' : 'Inactive') : '—';
  byId('sysSafeMode').textContent = 'Not reported by control plane';
  byId('sysTelegram').textContent = h?.telegramMode || '—';
  byId('sysProviders').textContent = r?.providers && typeof r.providers === 'object'
    ? Object.entries(r.providers).map(([name, mode]) => name + ': ' + mode).join(' · ')
    : '—';
  byId('sysWorkspace').textContent = byId('workspace').value || '—';
  byId('sysMode').textContent = store.testMode?.enabled ? 'Test fixture (mock-only)' : 'Production contracts';
  byId('sysPolling').textContent = document.hidden ? 'paused (page hidden)' : 'every ' + Math.round(store.pollMs / 100) / 10 + 's';
  byId('sysSync').textContent = store.lastSync ? fmtTime(store.lastSync) : '—';
  byId('sysPwa').textContent = store.swWaiting ? 'Update ready — reload to apply' : 'Current';
}

function renderEvidenceView() {
  const wrap = byId('evidenceView'); wrap.replaceChildren();
  const task = currentTask();
  if (!task) { wrap.append(el('p', 'empty', 'Select a task to inspect its evidence summary.')); return; }
  const head = el('p', 'mono', 'task ' + task.id);
  wrap.append(head, taskStatePill(task));
  const attr = latestAttribution(task);
  const facts = el('div', 'facts');
  const fact = (label, value) => { const f = el('div', 'fact'); f.append(el('span', 'label', label), el('span', 'value mono', value ?? '—')); return f; };
  facts.append(
    fact('Provider attribution', attr ? attr.provider + (attr.model ? ' / ' + attr.model : '') : 'Not dispatched'),
    fact('Worker attribution', task.worker_id || 'Unassigned'),
    fact('Redaction', 'Sanitized by control plane'),
    fact('Cost metadata', task.budget_cents != null ? 'budget ' + task.budget_cents + '¢' : '—'),
  );
  wrap.append(facts);
  const kinds = (task.evidenceMetadata || []).map((e) => e.kind);
  wrap.append(el('h3', null, 'Recorded evidence kinds'));
  if (kinds.length) { const row = el('div', 'row'); for (const kind of kinds) row.append(el('span', 'chip', kind)); wrap.append(row); }
  else wrap.append(el('p', 'muted stamp', 'None recorded yet.'));
  let outcome = null;
  if (task.summary) { try { outcome = JSON.parse(task.summary); } catch { outcome = { result: String(task.summary) }; } }
  if (outcome) {
    wrap.append(el('h3', null, 'Completion summary'));
    wrap.append(el('p', null, String(outcome.result || '—')));
    if (Array.isArray(outcome.changedFiles) && outcome.changedFiles.length) wrap.append(el('p', 'stamp mono', 'changed files: ' + outcome.changedFiles.length));
    if (outcome.validation) wrap.append(el('p', 'stamp mono', 'validation: recorded'));
  }
  const note = el('p', 'muted stamp', 'Full sanitized bundle: use the evidence downloads on the Task screen.');
  wrap.append(note);
}

function renderApprovalHistoryList(approvals) {
  const wrap = byId('approvalHistory'); wrap.replaceChildren();
  if (!approvals.length) { wrap.append(el('p', 'empty', 'No approval history for this task.')); return; }
  for (const a of approvals) {
    const line = el('p', 'stamp mono', fmtTime(a.created_at) + ' · ' + (a.action || '—') + ' → ' + (a.status || '—') + (a.decided_by ? ' by ' + a.decided_by : '') + (a.decision_note ? ' · ' + a.decision_note : ''));
    wrap.append(line);
  }
}
async function loadApprovalHistory() {
  if (!selectedTaskId) return;
  const { body } = await api.taskApprovals(selectedTaskId);
  renderApprovalHistoryList(body.approvals || []);
}

function render() {
  renderNav(); renderViews(); renderCore(); renderStatus(store.health);
  if (!store.authed) return;
  if (store.view === 'command') { renderCurrentTask(); renderAttribution(); renderRecentConversations(); }
  if (store.view === 'conversation') renderConversation();
  if (store.view === 'task') { renderTaskDetail(); loadApprovalHistory(); }
  if (store.view === 'events') renderEvents();
  if (store.view === 'approvals') renderApprovals();
  if (store.view === 'system') renderSystem();
  if (store.view === 'evidence') renderEvidenceView();
  const task = currentTask();
  if (task) {
    const key = task.id + ':' + task.status;
    if (store.announcedState && store.announcedState !== key && store.announcedState.startsWith(task.id + ':')) {
      announce('Task state: ' + statusInfo(task).label);
    }
    store.announcedState = key;
  }
}

/* ---------- data refresh with bounded backoff + visibility awareness ---------- */
let pollTimer = 0;
let refreshController = null;
async function refreshAll() {
  if (refreshController) refreshController.abort();
  const controller = new AbortController(); refreshController = controller;
  const signal = controller.signal;
  store.loading = true; store.refreshError = '';
  render();
  try {
    const { body: health } = await api.health(signal);
    store.health = health; store.offline = false;
    if (store.authed) {
      const [tasksRes, wsRes] = await Promise.all([api.tasks(signal), store.workspaces.length ? Promise.resolve(null) : api.workspaces(signal)]);
      if (tasksRes.body.tasks) store.tasks = tasksRes.body.tasks;
      if (!store.conversationId && store.taskId) {
        const known = store.tasks.find((t) => t.id === store.taskId);
        if (known?.conversation_id) store.conversationId = known.conversation_id;
      }
      if (wsRes?.body?.workspaces) { store.workspaces = wsRes.body.workspaces.filter(Boolean); renderWorkspaces(); }
      if (store.conversationId) {
        const { response, body } = await api.conversation(store.conversationId, signal);
        if (response.ok) {
          store.conversation = body;
          alignWorkspaceToCanonical(body.conversation?.workspace_id);
        }
        else if (response.status === 404) { store.conversation = null; }
      }
      if (store.view === 'system' && !store.ready) { const { body } = await api.ready(signal); store.ready = body; }
    }
    store.lastSync = new Date().toISOString();
    store.pollMs = 2500;
  } catch (error) {
    if (error.name === 'AbortError') return;
    store.offline = true;
    store.refreshError = 'Connection unavailable';
    store.pollMs = Math.min(Math.round(store.pollMs * 1.7), 30000);
  }
  store.loading = false;
  byId('offlineBar').classList.toggle('show', store.offline);
  render();
  schedulePoll();
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(refreshAll, store.pollMs);
}
function refreshSoon() { clearTimeout(pollTimer); pollTimer = setTimeout(refreshAll, 60); }
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('paused', document.hidden);
  store.helix?.setPaused(document.hidden);
  if (document.hidden) { clearTimeout(pollTimer); if (refreshController) refreshController.abort(); }
  else refreshSoon();
});
window.addEventListener('pagehide', () => {
  clearTimeout(pollTimer);
  if (refreshController) refreshController.abort();
  store.helix?.destroy();
  store.helix = null;
});
window.addEventListener('online', refreshSoon);
window.addEventListener('offline', () => { store.offline = true; byId('offlineBar').classList.add('show'); render(); });

function renderWorkspaces() {
  const select = byId('workspace'); const previous = select.value;
  select.replaceChildren();
  for (const ws of store.workspaces) {
    const option = el('option', null, ws.name || ws.id); option.value = ws.id;
    select.append(option);
  }
  if (previous) select.value = previous;
}
function alignWorkspaceToCanonical(workspaceId) {
  if (!workspaceId || store.workspaceTouched || !store.workspaces.some((ws) => ws.id === workspaceId)) return;
  byId('workspace').value = workspaceId;
}

/* ---------- submission (idempotent, double-submit safe) ---------- */
async function submitCommand(text, conversationId, noticeId) {
  const trimmed = String(text || '').trim();
  if (!trimmed) { setNotice(noticeId, 'Enter a command first.'); return; }
  if (store.inflight) return;
  store.inflight = true;
  byId('sendBtn').disabled = true; byId('followBtn').disabled = true;
  if (!store.idemKey) store.idemKey = 'jarvis-' + crypto.randomUUID();
  setNotice(noticeId, 'Submitting to Unified Input…');
  try {
    const { response, body } = await api.submitInput({ text: trimmed, workspaceId: byId('workspace').value || undefined, conversationId: conversationId || undefined, idempotencyKey: store.idemKey });
    if (body.taskId) {
      store.conversationId = body.conversationId || store.conversationId;
      store.taskId = body.taskId; selectedTaskId = body.taskId;
      store.idemKey = '';
      byId('cmd').value = ''; byId('followCmd').value = '';
      if (body.denied || body.error) {
        setNotice(noticeId, 'Denied by Blackspire policy: ' + (body.error || 'not permitted.'));
        announce('Command denied by policy');
      } else {
        setNotice(noticeId, body.duplicate ? 'Duplicate submission — existing canonical task returned.' : 'Accepted into canonical state.');
        announce(body.duplicate ? 'Duplicate prevented' : 'Command accepted');
      }
      if (location.hash.indexOf('#/conversation') !== 0) go('conversation', store.conversationId);
      await refreshAll();
    } else if (response.status === 429) {
      setNotice(noticeId, 'Rate limited — retry in ' + (body.retryAfter || 'a few') + 's. Your idempotency key is preserved.');
    } else {
      setNotice(noticeId, body.error || 'The control plane rejected this input.');
    }
  } catch {
    setNotice(noticeId, 'Connection failed — command not confirmed. Resubmitting will reuse the same idempotency key.');
  } finally {
    store.inflight = false;
    byId('sendBtn').disabled = false; byId('followBtn').disabled = false;
  }
}

/* ---------- evidence export (server-sanitized) ---------- */
function downloadExport(format) {
  if (!selectedTaskId) { toast('Select a task before downloading evidence.'); return; }
  const link = document.createElement('a');
  link.href = `/api/tasks/${selectedTaskId}/export.${format}`;
  link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
}

/* ---------- auth ---------- */
async function checkSession() {
  const { body } = await api.session();
  store.authed = Boolean(body.authenticated);
  if (body.csrfToken) store.csrfToken = body.csrfToken;
  if (!store.authed && store.csrfToken) setNotice('sessionNotice', 'Session expired or not signed in. Enter the admin token to continue.');
  return store.authed;
}
async function login() {
  const input = byId('token');
  const { response, body } = await api.login(input.value);
  input.value = '';
  if (!response.ok) { setNotice('sessionNotice', response.status === 429 ? 'Too many attempts — wait a minute and retry.' : 'Sign-in failed. Check the admin token.'); return; }
  store.csrfToken = body.csrfToken || ''; store.authed = true;
  setNotice('sessionNotice', '');
  toast('Signed in.');
  await refreshAll();
}
async function logout() {
  await api.logout();
  store.authed = false; store.csrfToken = ''; store.conversation = null; store.tasks = [];
  setNotice('sessionNotice', 'Signed out.');
  render();
}

/* ---------- emergency stop (two-step, server-authoritative) ---------- */
let stopArmed = false;
async function emergencyStop() {
  const btn = byId('stopBtn');
  if (!stopArmed) { stopArmed = true; btn.textContent = 'Confirm emergency stop'; setNotice('stopNotice', 'Press again to confirm. This freezes dispatch immediately.'); setTimeout(() => { stopArmed = false; btn.textContent = 'Emergency stop'; }, 6000); return; }
  stopArmed = false; btn.textContent = 'Emergency stop';
  const { response, body } = await api.stop();
  setNotice('stopNotice', response.ok ? 'Emergency stop is ACTIVE. Dispatch is frozen by the control plane.' : body.error || 'The control plane did not confirm the stop.');
  announce('Emergency stop ' + (response.ok ? 'active' : 'not confirmed'));
  await refreshAll();
}
let resetArmed = false;
async function emergencyStopReset() {
  const btn = byId('stopResetBtn');
  if (!resetArmed) { resetArmed = true; btn.textContent = 'Confirm reset'; setNotice('stopNotice', 'Press again to confirm reset. Requires a fresh session.'); setTimeout(() => { resetArmed = false; btn.textContent = 'Reset emergency stop'; }, 6000); return; }
  resetArmed = false; btn.textContent = 'Reset emergency stop';
  const { response, body } = await api.stopReset();
  setNotice('stopNotice', response.ok ? 'Emergency stop reset by the control plane.' : body.error || 'Reset declined by the control plane.');
  await refreshAll();
}

/* ---------- cancellation ---------- */
async function cancelCurrentTask() {
  const task = currentTask();
  if (!cancellable(task)) return;
  byId('cancelBtn').disabled = true;
  const { response, body } = await api.cancelTask(task.id);
  if (response.ok && body.task) {
    setNotice('taskNotice', body.task.status === 'cancelled' ? 'Canonical cancellation recorded.' : 'Cancellation requested — state: ' + (STATUS[body.task.status]?.label || body.task.status));
    announce('Task ' + (body.task.status === 'cancelled' ? 'cancelled' : 'cancellation requested'));
  } else {
    setNotice('taskNotice', body.error || 'Cancellation unavailable for this task.');
  }
  await refreshAll();
}

/* ---------- copy controls ---------- */
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const value = byId(button.dataset.copy)?.textContent || '';
  try { await navigator.clipboard.writeText(value); toast('Copied.'); } catch { toast('Copy unavailable.'); }
});

/* ---------- service worker: offline shell + explicit update flow ---------- */
let applyingUpdate = false; // reload only after the operator chose to update — never on first install
async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // A first install has no earlier version to update from, and the worker is briefly
    // "waiting" before it activates — so gate on an existing controller and re-evaluate
    // on every state change instead of latching the bar on.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('/sw.js');
    const trackWaiting = () => {
      const waiting = hadController ? registration.waiting : null;
      store.swWaiting = waiting;
      byId('updateBar').classList.toggle('show', Boolean(waiting));
      renderSystem();
    };
    trackWaiting();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', trackWaiting);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (applyingUpdate) location.reload(); });
  } catch { /* offline shell is optional; the app works without it */ }
}
byId('applyUpdate').addEventListener('click', () => { if (store.swWaiting) { applyingUpdate = true; store.swWaiting.postMessage({ type: 'SKIP_WAITING' }); } });

/* ---------- optional Helix enhancement: never awaited by boot ---------- */
function loadHelixEnhancement() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = () => {
    import('/helix-core.js').then(({ mountHelixCore }) => {
      store.helix = mountHelixCore({ container: byId('helixMount'), initialState: coreStateFor()[0] });
      store.helix.setPaused(document.hidden);
    }).catch(() => {
      byId('helixMount').dataset.helixFallback = 'svg';
    });
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 1800 });
  else setTimeout(start, 300);
}

/* ---------- wire up ---------- */
byId('loginBtn').addEventListener('click', login);
byId('logoutBtn').addEventListener('click', logout);
byId('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
byId('sendBtn').addEventListener('click', () => submitCommand(byId('cmd').value, store.conversationId, 'composerNotice'));
byId('followBtn').addEventListener('click', () => submitCommand(byId('followCmd').value, store.conversationId, 'followNotice'));
byId('cmd').addEventListener('input', () => { store.idemKey = ''; });
byId('followCmd').addEventListener('input', () => { store.idemKey = ''; });
byId('cmd').addEventListener('focus', renderCore);
byId('cmd').addEventListener('blur', renderCore);
byId('followCmd').addEventListener('focus', renderCore);
byId('followCmd').addEventListener('blur', renderCore);
byId('cancelBtn').addEventListener('click', cancelCurrentTask);
byId('stopBtn').addEventListener('click', emergencyStop);
byId('stopResetBtn').addEventListener('click', emergencyStopReset);
byId('exportJsonBtn').addEventListener('click', () => downloadExport('json'));
byId('exportMdBtn').addEventListener('click', () => downloadExport('md'));
byId('workspace').addEventListener('change', () => {
  store.workspaceTouched = true;
  const conversationWorkspace = store.conversation?.conversation?.workspace_id;
  if (conversationWorkspace && conversationWorkspace !== activeWorkspaceId()) {
    store.conversationId = ''; store.conversation = null; store.taskId = ''; selectedTaskId = '';
    if (store.view !== 'command' && store.view !== 'system') go('command');
  }
  render();
});
byId('micBtn').addEventListener('click', () => { /* disabled: voice state stays '${voice.state}' until a voice service is authorized */ });

/* ---------- boot ---------- */
(async function boot() {
  parseHash();
  document.documentElement.classList.toggle('paused', document.hidden);
  api.testMode().then(({ body }) => { store.testMode = body; render(); }).catch(() => {});
  await checkSession();
  render();
  await refreshAll();
  initServiceWorker();
  loadHelixEnhancement();
})();
