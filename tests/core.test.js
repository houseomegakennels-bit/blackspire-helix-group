import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-core-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'core.sqlite');
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { createTask, getTask, transition, setFlag, getFlag } = await import('../packages/task-engine/tasks.js');
const { decide, isAllowedPath } = await import('../packages/policy/policy.js');
const { getWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { selectProvider } = await import('../packages/providers/providers.js');
const { runAllowed } = await import('../packages/execution/runner.js');

test('task lifecycle supports queued, running, completed, cancelled', () => {
  const task = createTask({ workspaceId: 'blackspire-command', request: 'write docs', idempotencyKey: `life-${Date.now()}` });
  assert.equal(task.status, 'queued');
  assert.equal(transition(task.id, 'running').status, 'running');
  assert.equal(transition(task.id, 'completed').status, 'completed');
  assert.equal(transition(task.id, 'cancelled').status, 'cancelled');
});

test('policy requires approval for high impact and allows low risk', () => { assert.equal(decide('production_deploy').requiresApproval, true); assert.equal(decide('read_files').allowed, true); });
test('workspace isolation blocks path traversal', () => { assert.equal(isAllowedPath('../.env', ['docs']), false); assert.equal(isAllowedPath('docs/readme.md', ['docs']), true); });
test('provider routing defaults to mock and never silently selects a paid provider', () => {
  const previousMode = process.env.BLACKSPIRE_PROVIDER_MODE; const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.BLACKSPIRE_PROVIDER_MODE; process.env.OPENAI_API_KEY = 'controlled-test-value';
  assert.equal(selectProvider({ preferred: ['openai', 'anthropic', 'manual'] }).provider, 'mock');
  process.env.BLACKSPIRE_PROVIDER_MODE = 'openai'; assert.equal(selectProvider({ preferred: ['openai', 'manual'] }).provider, 'openai');
  if (previousMode === undefined) delete process.env.BLACKSPIRE_PROVIDER_MODE; else process.env.BLACKSPIRE_PROVIDER_MODE = previousMode;
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
});
test('command allowlist blocks bypass', async () => { assert.equal((await runAllowed('rm -rf /', { allowedCommands: ['npm test'] })).ok, false); });
test('workspace record has required fields', () => { const workspace = getWorkspace('blackspire-command'); assert.equal(workspace.id, 'blackspire-command'); assert.ok(Array.isArray(workspace.allowed_paths)); assert.ok(workspace.github_repository); });
test('emergency stop flag persists', () => { setFlag('emergency_stop', 'active'); assert.equal(getFlag('emergency_stop'), 'active'); setFlag('emergency_stop', 'inactive'); });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
