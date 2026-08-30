import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-canonical-result-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'canonical.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'canonical-result-test-token';
process.env.PORT = '8914';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { provisionRouteAuthorization } = await import('./helpers/provision-route-authorization.js');
provisionRouteAuthorization(['blackspire-command']);
const {
  CANONICAL_RESULT_MAX_CHARS, EMPTY_COMPLETION_RESULT, isMeaningfulTaskResult,
  resolveCanonicalTaskResult,
} = await import('../packages/task-engine/canonical-result.js');
const { createTask, getTask, recordProviderAttempt, taskRecords, transition } = await import('../packages/task-engine/tasks.js');
const { createUnifiedInput, getConversation } = await import('../packages/unified-input/unified.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { closeDb } = await import('../packages/task-engine/db.js');
const { start } = await import('../apps/api/server.js');

const completed = (id, result = 'completed') => ({ id, status: 'completed', summary: JSON.stringify({ result }) });
const attempt = (taskId, summary, status = 'completed') => ({ task_id: taskId, status, response_packet: JSON.stringify({ summary }) });

test('canonical result contract covers task preference, historical fallback, empty fallback, and legitimate prose', () => {
  assert.equal(resolveCanonicalTaskResult(completed('meaningful', 'Workspace is healthy.'), [attempt('meaningful', 'ignored')]), 'Workspace is healthy.');
  assert.equal(resolveCanonicalTaskResult(completed('historical'), [attempt('historical', 'Original persisted provider report.')]), 'Original persisted provider report.');
  assert.equal(resolveCanonicalTaskResult(completed('empty'), []), EMPTY_COMPLETION_RESULT);
  assert.equal(isMeaningfulTaskResult('The migration completed successfully and all checks passed.'), true);
  assert.equal(resolveCanonicalTaskResult(completed('prose', 'The migration completed successfully and all checks passed.'), []), 'The migration completed successfully and all checks passed.');
});

test('only an unambiguous same-task completed attempt can supply fallback text', () => {
  for (const status of ['failed', 'cancelled', 'outcome_unknown']) {
    assert.equal(resolveCanonicalTaskResult({ id: status, status, summary: '{"result":"completed"}' }, [attempt(status, 'must not leak')]), null);
  }
  assert.equal(resolveCanonicalTaskResult(completed('failed-attempt'), [attempt('failed-attempt', 'old success', 'failed')]), EMPTY_COMPLETION_RESULT);
  assert.equal(resolveCanonicalTaskResult(completed('wrong-task'), [attempt('someone-else', 'wrong owner')]), EMPTY_COMPLETION_RESULT);
  assert.equal(resolveCanonicalTaskResult(completed('duplicate'), [attempt('duplicate', 'first'), attempt('duplicate', 'unowned duplicate')]), EMPTY_COMPLETION_RESULT);
  assert.equal(resolveCanonicalTaskResult(completed('retry'), [attempt('retry', 'superseded failure', 'failed'), attempt('retry', 'authoritative success')]), 'authoritative success');
});

test('provider summaries are redacted, normalized, deterministically bounded, and remain inert text', () => {
  const payload = `<script>alert('x')</script> token=super-secret\r\n${'z'.repeat(CANONICAL_RESULT_MAX_CHARS)}`;
  const result = resolveCanonicalTaskResult(completed('bounded'), [attempt('bounded', payload)]);
  assert.equal(result.length, CANONICAL_RESULT_MAX_CHARS);
  assert.ok(result.endsWith('…'));
  assert.match(result, /^<script>alert\('x'\)<\/script> token=\[REDACTED\]\n/);
  assert.doesNotMatch(result, /super-secret/);
});

function persistCompletedInput(key, text, result, providerSummary) {
  const created = createUnifiedInput({ channel: 'jarvis', actorId: 'canonical-user', channelKey: 'canonical-session', conversationId: key.conversationId || null, workspaceId: 'blackspire-command', text, idempotencyKey: key.id, executionIntent: 'read_only', authority: 'authenticated_admin' });
  transition(created.taskId, 'completed', { summary: { result } });
  if (providerSummary !== undefined) recordProviderAttempt(created.taskId, { provider: 'codex', mode: 'cli', status: 'completed', responsePacket: { summary: providerSummary } });
  return created;
}

test('conversation derives stable task-id-bound Jarvis results for multiple follow-ups and reloads', () => {
  const first = persistCompletedInput({ id: 'conversation-first' }, 'First request', 'completed', 'First response');
  const second = persistCompletedInput({ id: 'conversation-second', conversationId: first.conversationId }, 'Second request', 'Second task response');
  const before = getConversation(first.conversationId);
  assert.deepEqual(before.tasks.map(({ id, input_id, canonicalResult }) => ({ id, input_id, canonicalResult })), [
    { id: first.taskId, input_id: first.inputId, canonicalResult: 'First response' },
    { id: second.taskId, input_id: second.inputId, canonicalResult: 'Second task response' },
  ]);
  closeDb();
  const after = getConversation(first.conversationId);
  assert.deepEqual(after.tasks.map(({ id, canonicalResult }) => ({ id, canonicalResult })), before.tasks.map(({ id, canonicalResult }) => ({ id, canonicalResult })));
});

let server;
test('authorized Task, Conversation, Evidence, and task list expose one identical canonical result', async () => {
  server = start(8914, undefined, { exitOnListenError: false });
  const created = persistCompletedInput({ id: 'api-consistency' }, 'API consistency', 'completed', 'One canonical API response');
  const headers = { authorization: 'Bearer canonical-result-test-token' };
  const taskBody = await (await fetch(`http://localhost:8914/api/tasks/${created.taskId}`, { headers })).json();
  const listBody = await (await fetch('http://localhost:8914/api/tasks', { headers })).json();
  const conversationBody = await (await fetch(`http://localhost:8914/api/conversations/${created.conversationId}`, { headers })).json();
  const evidenceBody = await (await fetch(`http://localhost:8914/api/tasks/${created.taskId}/export.json`, { headers })).json();
  const results = [taskBody.task.canonicalResult, listBody.tasks.find((row) => row.id === created.taskId).canonicalResult,
    conversationBody.tasks.find((row) => row.id === created.taskId).canonicalResult, evidenceBody.canonicalResult];
  assert.deepEqual(results, Array(4).fill('One canonical API response'));
  assert.equal(taskRecords(created.taskId).providerAttempts.length, 1, 'reads never create a duplicate attempt');
});

test('task-list canonical results use one provider-attempt batch rather than full task records', () => {
  const serverSource = fs.readFileSync(path.join(process.cwd(), 'apps/api/server.js'), 'utf8');
  const listRoute = serverSource.slice(serverSource.indexOf("u.pathname === '/api/tasks'"), serverSource.indexOf("u.pathname === '/api/tasks'", serverSource.indexOf("u.pathname === '/api/tasks'") + 1));
  assert.match(listRoute, /providerAttemptsForTasks\(authorized\.map/);
  assert.doesNotMatch(listRoute, /taskRecords\(/);
});

test('cross-workspace API authorization denies before exposing provider fallback', async () => {
  upsertWorkspace({ id: 'canonical-victim', name: 'Victim', githubRepository: 'local/victim', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['mock'] }, budgetCents: 1, rootPath: process.cwd() });
  const victim = createTask({ workspaceId: 'canonical-victim', request: 'private', idempotencyKey: 'canonical-victim', initialStatus: 'completed', initialSummary: { result: 'completed' } });
  recordProviderAttempt(victim.id, { provider: 'codex', mode: 'cli', status: 'completed', responsePacket: { summary: 'private provider response' } });
  const response = await fetch(`http://localhost:8914/api/tasks/${victim.id}`, { headers: { authorization: 'Bearer canonical-result-test-token' } });
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /private provider response/);
});

test('close canonical-result API', () => server.close());
