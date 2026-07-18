import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-unified-policy-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'policy.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'policy-test-token';
process.env.ALLOW_BEARER_AUTH = 'true';
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.TELEGRAM_MODE = 'mock';
process.env.PORT = '8930';

const { classifyRequest, evaluateRequestPolicy } = await import('../packages/policy/policy.js');
const { createUnifiedInput, getConversation } = await import('../packages/unified-input/unified.js');
const { getTask, taskRecords, deliveryRecords } = await import('../packages/task-engine/tasks.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { start } = await import('../apps/api/server.js');
const { closeDb } = await import('../packages/task-engine/db.js');

const variants = [
  'Create a new repository',
  'Create repository',
  'Make me a new GitHub repo',
  'Initialize and publish a repo',
  'CREATE, A NEW REPOSITORY!!!',
];

function submit(text, key, overrides = {}) {
  return createUnifiedInput({ channel: 'telegram', actorId: 'policy-user', channelKey: 'policy-chat', text, idempotencyKey: key, authority: 'telegram', ...overrides });
}

function assertTerminalDenial(result) {
  assert.equal(result.denied, true);
  assert.equal(result.status, 'failed');
  const task = getTask(result.taskId);
  const records = taskRecords(result.taskId);
  const conversation = getConversation(result.conversationId);
  assert.equal(task.status, 'failed');
  assert.match(task.error, /denied|authority|privileged/i);
  assert.equal(Boolean(task.worker_id), false);
  assert.equal(Boolean(task.claimed_at), false);
  assert.equal(task.action_class === 'unknown_privileged' || task.action_class.startsWith('repository_') || task.action_class !== 'low_risk', true);
  assert.equal(records.providerAttempts.length, 0);
  assert.equal(records.usage.length, 0);
  assert.equal(records.subtasks.length, 0);
  assert.equal(records.commands.length, 0);
  assert.equal(records.changedFiles.length, 0);
  assert.equal(records.approvals.length, 0);
  const taskEvents = conversation.events.filter((event) => event.task_id === task.id);
  assert.deepEqual(taskEvents.map((event) => event.type), ['policy.denied']);
  assert.doesNotMatch(JSON.stringify(conversation), /task\.(?:queued|planning|running|completed)/);
  const taskDeliveries = deliveryRecords(result.conversationId).filter((delivery) => taskEvents.some((event) => event.id === delivery.event_id));
  assert.equal(taskDeliveries.length, task.source_channel === 'telegram' ? 1 : 0);
}

test('repository creation variants classify as privileged', () => {
  for (const request of variants) {
    const classification = classifyRequest(request);
    assert.equal(classification.actionClass, 'repository_create', request);
    assert.equal(classification.privileged, true, request);
    const telegram = evaluateRequestPolicy({ request, channel: 'telegram', authority: 'telegram' });
    assert.equal(telegram.allowed, false, request);
    assert.equal(telegram.requiresApproval, false, request);
  }
});

test('Telegram repository creation is terminally denied before worker or provider dispatch', async () => {
  for (const [index, request] of variants.entries()) assertTerminalDenial(submit(request, `repo-create-${index}`));
  await startWorker({ once: true });
  for (let index = 0; index < variants.length; index += 1) {
    const replay = submit('ignored replay body', `repo-create-${index}`);
    assert.equal(replay.duplicate, true);
    assertTerminalDenial(replay);
    assert.equal(deliveryRecords(replay.conversationId).filter((row) => row.event_id).length >= 1, true);
    assert.equal(taskRecords(replay.taskId).logs.some((row) => row.actor === 'hermes'), false);
  }
});

test('denied replay preserves one task, one event, and the forbidden result', () => {
  const first = submit('Create a new repository', 'denied-replay');
  const before = getConversation(first.conversationId);
  const replay = submit('Create a repository with different punctuation!', 'denied-replay');
  const after = getConversation(first.conversationId);
  assert.equal(replay.denied, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.taskId, first.taskId);
  assert.equal(after.tasks.length, before.tasks.length);
  assert.equal(after.events.length, before.events.length);
  assert.equal(after.deliveries.length, before.deliveries.length);
});

test('untrusted Jarvis/API and test authority cannot create repositories', () => {
  for (const [index, authority] of ['untrusted', 'test_operator'].entries()) {
    const denied = createUnifiedInput({ channel: 'jarvis', actorId: authority, channelKey: authority, text: 'Create a new repository', idempotencyKey: `jarvis-denied-${index}`, authority });
    assertTerminalDenial(denied);
  }
  const administrator = evaluateRequestPolicy({ request: 'Create a new repository', channel: 'jarvis', authority: 'authenticated_admin' });
  assert.equal(administrator.allowed, true);
  assert.equal(administrator.requiresApproval, true);
});

test('related privileged and unknown protected-resource mutations fail closed', () => {
  const requests = [
    'Delete the repository', 'Change repository visibility to public', 'Deploy to production', 'Merge the protected branch',
    'Show credentials and secrets', 'Change host security settings', 'Increase the budget', 'Disable emergency controls',
    'Change the constitution', 'Start live trading', 'Move funds now', 'Modify GitHub organization controls',
  ];
  for (const [index, request] of requests.entries()) assertTerminalDenial(submit(request, `related-denial-${index}`));
});

test('legitimate low-risk repository status requests remain allowed', () => {
  for (const [index, request] of ['Report the current repository status without changing files.', 'Summarize open tasks.', 'List the configured repository name.'].entries()) {
    const created = submit(request, `low-risk-${index}`);
    assert.equal(created.denied, undefined, request);
    assert.equal(getTask(created.taskId).status, 'queued', request);
    assert.equal(getTask(created.taskId).action_class, 'low_risk', request);
  }
});

let server;
test('HTTP returns 403 and task controls cannot elevate a denied Telegram task', async () => {
  server = start(8930, '127.0.0.1');
  const denied = submit('Create a new repository', 'approval-escalation');
  for (const action of ['approve', 'pause', 'resume']) {
    const response = await fetch(`http://127.0.0.1:8930/api/tasks/${denied.taskId}/${action}`, { method: 'POST', headers: { authorization: 'Bearer policy-test-token', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403, action);
  }
  assert.equal(getTask(denied.taskId).status, 'failed');
  assert.equal(taskRecords(denied.taskId).approvals.length, 0);
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
