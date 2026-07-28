// Hermes Intelligence Layer — Milestone 1 tests.
//
// Proves the M1 vertical slice and its safety guarantees:
//   Jarvis task -> Hermes normalization -> mock routing -> mock execution -> verification
//                -> event recording -> memory candidate creation (pending, never promoted)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'hermes.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'hermes-test-token';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.PORT = '8903';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);

const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask, setFlag } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { normalizeTask } = await import('../packages/hermes-orchestrator/normalize.js');
const { classifyTask } = await import('../packages/hermes-orchestrator/classify.js');
const { routeTask } = await import('../packages/hermes-orchestrator/route.js');
const { redactDeep } = await import('../packages/hermes-orchestrator/redaction.js');
const { withinBudget, executeWorkflow } = await import('../packages/hermes-orchestrator/execute.js');
const { verifyExecution } = await import('../packages/hermes-orchestrator/verify.js');
const { extractMemoryCandidate } = await import('../packages/hermes-orchestrator/memory.js');
const { all } = await import('../packages/task-engine/db.js');

function seedWorkspace(id) {
  upsertWorkspace({
    id, name: id, description: 'hermes test workspace', githubRepository: 'local/hermes-test',
    defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['true'],
    providerPolicy: { preferred: ['mock'] }, riskLevel: 'low', budgetCents: 100,
    secretReferences: [], enabledTools: ['status', 'read'], lastHealthStatus: 'ok', rootPath: root,
  });
}

test('vertical slice: Jarvis task flows through Hermes to a pending memory candidate', async () => {
  seedWorkspace('hermes-ws-1');
  const input = createUnifiedInput({ channel: 'jarvis', actorId: 'session-1', channelKey: 'session-1', workspaceId: 'hermes-ws-1', text: 'write a harmless status summary to `docs/hermes-status.md`', idempotencyKey: 'jarvis-hermes-1' });
  const task = getTask(input.taskId);
  assert.ok(task, 'unified input created a canonical task');

  const result = await runHermesWorkflow(task);
  assert.equal(result.status, 'completed');
  assert.equal(result.outcome, 'verified');
  assert.equal(result.verification.passed, true);

  // Ordered workflow steps were recorded, in sequence, ending at completion.
  const steps = store.getWorkflowSteps(result.runId);
  const stepNames = steps.map((s) => s.name);
  assert.deepEqual(steps.map((s) => s.seq), steps.map((_, i) => i + 1), 'steps are sequentially numbered');
  assert.ok(stepNames.includes('hermes.classified'));
  assert.ok(stepNames.includes('hermes.routed'));
  assert.ok(stepNames.includes('hermes.executed'));
  assert.ok(stepNames.includes('hermes.verified'));
  assert.equal(stepNames[stepNames.length - 1], 'hermes.completed');

  // Routing + verification decisions persisted.
  assert.equal(store.getRoutingDecisions(result.runId)[0].selected_provider, 'mock');
  assert.equal(store.getVerificationResults(result.runId)[0].passed, 1);

  // Memory candidate created but PENDING — never promoted.
  const candidates = store.getMemoryCandidates(result.runId);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'pending');
  assert.equal(candidates[0].promoted_at, null);

  // The canonical ordered event stream (reused task_events) carries the Hermes events.
  const events = all('SELECT type FROM task_events WHERE task_id=?', [task.id]).map((r) => r.type);
  assert.ok(events.includes('hermes.completed'));
});

test('high-risk task is blocked pending approval and never executes or learns', async () => {
  seedWorkspace('hermes-ws-2');
  const input = createUnifiedInput({ channel: 'jarvis', actorId: 'session-2', channelKey: 'session-2', workspaceId: 'hermes-ws-2', text: 'deploy to production and delete the old secret token', idempotencyKey: 'jarvis-hermes-risk-1' });
  const task = getTask(input.taskId);
  const result = await runHermesWorkflow(task);
  assert.equal(result.status, 'blocked');
  assert.equal(result.outcome, 'blocked_pending_approval');
  // No routing, no execution, no memory candidate for a blocked run.
  assert.equal(store.getRoutingDecisions(result.runId).length, 0);
  assert.equal(store.getMemoryCandidates(result.runId).length, 0);
  const policy = store.getPolicyDecisions(result.runId)[0];
  assert.equal(policy.requires_approval, 1);
});

test('secrets are redacted from persisted objective and steps', async () => {
  seedWorkspace('hermes-ws-3');
  // Constructed at runtime so no literal secret-shaped string lives in the source (keeps the
  // repository secret scanner clean) while still exercising the redactor on a realistic value.
  const secret = 'sk-' + 'a'.repeat(24);
  const result = await runHermesWorkflow({ id: 'synthetic-task-redact', workspace_id: 'hermes-ws-3', request: `summarize status; my api_key=${secret}`, source_channel: 'api', actor_id: 'tester', budget_cents: 0, idempotency_key: 'redact-1' });
  const run = store.getWorkflowRun(result.runId);
  assert.ok(!run.objective.includes(secret), 'objective column must not contain the raw secret');
  assert.match(run.objective, /REDACTED/);
  const serializedSteps = JSON.stringify(store.getWorkflowSteps(result.runId));
  assert.ok(!serializedSteps.includes(secret), 'no workflow step may contain the raw secret');
});

test('memory candidates are only ever pending (no promotion path in M1)', () => {
  const pending = store.getPendingMemoryCandidates();
  assert.ok(pending.length >= 1);
  assert.ok(pending.every((c) => c.status === 'pending' && c.promoted_at === null));
});

test('kill switch refuses new orchestration', async () => {
  seedWorkspace('hermes-ws-4');
  setFlag('emergency_stop', 'active');
  try {
    const result = await runHermesWorkflow({ id: 'synthetic-killswitch', workspace_id: 'hermes-ws-4', request: 'report status', source_channel: 'api', actor_id: 'tester', budget_cents: 0, idempotency_key: 'kill-1' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.outcome, 'emergency_stop');
  } finally {
    setFlag('emergency_stop', 'cleared');
  }
});

test('unit: normalize validates and redacts; classify + route are deterministic and mock-only', () => {
  assert.throws(() => normalizeTask({}), /taskId is required/);
  const n = normalizeTask({ id: 't1', workspace_id: 'w1', request: '  Fix the bug in the parser  ' });
  assert.equal(n.taskId, 't1');
  const c = classifyTask(n);
  assert.equal(c.domain, 'code');
  const r = routeTask(c);
  assert.equal(r.provider, 'mock');
  assert.ok(r.candidates.every((cand) => cand.provider === 'mock'));
});

test('unit: deep redaction drops sensitive keys and patterns', () => {
  const out = redactDeep({ token: 'value-dropped-because-key-is-sensitive', nested: { note: 'password=hunter2', ok: 'plain text' } });
  assert.equal(out.token, '[REDACTED]');
  assert.match(out.nested.note, /REDACTED/);
  assert.equal(out.nested.ok, 'plain text');
});

test('unit: redaction handles nested arrays, Error objects, bigint, and cyclic input', () => {
  const secret = 'sk-' + 'z'.repeat(24);
  // nested arrays + objects
  const nested = redactDeep({ items: [{ apiKey: 'x' }, { note: `key=${secret}` }], deep: [[[`token ${secret}`]]] });
  assert.equal(nested.items[0].apiKey, '[REDACTED]');
  assert.match(nested.items[1].note, /REDACTED/);
  assert.match(nested.deep[0][0][0], /REDACTED/);
  assert.ok(!JSON.stringify(nested).includes(secret));
  // Error objects are reduced to a redacted {name,message}, not silently dropped
  const err = redactDeep(new Error(`boom ${secret}`));
  assert.equal(err.name, 'Error');
  assert.match(err.message, /REDACTED/);
  assert.ok(!err.message.includes(secret));
  // bigint
  assert.equal(typeof redactDeep(10n), 'string');
  // cyclic input does not throw and yields a cycle marker
  const cyc = { a: 1 }; cyc.self = cyc;
  const red = redactDeep(cyc);
  assert.equal(red.a, 1);
  assert.equal(red.self, '[REDACTED:cycle]');
  // a shared (non-cyclic) sibling reference is NOT falsely marked as a cycle
  const shared = { k: 'v' };
  const both = redactDeep({ a: shared, b: shared });
  assert.deepEqual(both, { a: { k: 'v' }, b: { k: 'v' } });
});

test('unit: normalize rejects malformed tasks and caps oversized objectives', () => {
  assert.throws(() => normalizeTask({ id: 't', request: 'x' }), /workspaceId is required/);
  assert.throws(() => normalizeTask({ id: 't', workspace_id: 'w' }), /objective\/request is required/);
  assert.throws(() => normalizeTask({ id: 't', workspace_id: 'w', request: 'x', budget_cents: -5 }), /budgetCents/);
  const big = normalizeTask({ id: 't', workspace_id: 'w', request: 'a'.repeat(9000) });
  assert.equal(big.objective.length, 4000, 'objective is capped at 4000 chars');
});

test('unit: withinBudget compares actual cost to ceiling', () => {
  assert.equal(withinBudget(0, 0), true);
  assert.equal(withinBudget(0, 100), true);
  assert.equal(withinBudget(50, 100), true);
  assert.equal(withinBudget(150, 100), false);
});

test('unit: verifier fails a bad execution and the extractor refuses to learn from it', () => {
  const bad = { ok: false, provider: 'mock', summary: '', artifacts: [], usage: { costCents: 0 }, error: 'x' };
  const v = verifyExecution(bad, { classification: { requiredCapabilities: ['status.report'] } });
  assert.equal(v.passed, false);
  const refusal = extractMemoryCandidate({ runId: 'r', normalized: { taskId: 't', workspaceId: 'w' }, classification: { domain: 'status', risk: 'low', complexity: 'trivial', requiredCapabilities: ['status.report'] }, verification: v });
  assert.equal(refusal.created, false, 'no memory candidate may be created from an unverified run');
});

test('verifier rejects an artifact path traversal; the run fails and learns nothing', async () => {
  seedWorkspace('hermes-ws-trav');
  const result = await runHermesWorkflow({ id: 'synthetic-traversal', workspace_id: 'hermes-ws-trav', request: 'refactor the parser and save output to `../../escape.txt`', source_channel: 'api', actor_id: 'tester', budget_cents: 0, idempotency_key: 'trav-1' });
  assert.equal(result.status, 'failed');
  assert.equal(result.outcome, 'verification_failed');
  assert.equal(store.getMemoryCandidates(result.runId).length, 0);
});

test('production profile refuses even mock provider execution (no provider execution reaches production)', async () => {
  const saved = { rt: process.env.BLACKSPIRE_RUNTIME_MODE, pm: process.env.BLACKSPIRE_PROVIDER_MODE };
  process.env.BLACKSPIRE_RUNTIME_MODE = 'production';
  process.env.BLACKSPIRE_PROVIDER_MODE = 'manual';
  try {
    const execution = await executeWorkflow({ provider: 'mock' }, { taskId: 't', objective: 'report status', idempotencyKey: 'k' });
    assert.equal(execution.ok, false, 'mock execution must be refused under the production profile');
    assert.match(String(execution.error), /disabled by the production profile|disabled-by-profile/i);
  } finally {
    if (saved.rt === undefined) delete process.env.BLACKSPIRE_RUNTIME_MODE; else process.env.BLACKSPIRE_RUNTIME_MODE = saved.rt;
    if (saved.pm === undefined) delete process.env.BLACKSPIRE_PROVIDER_MODE; else process.env.BLACKSPIRE_PROVIDER_MODE = saved.pm;
  }
});

test('duplicate orchestrator runs on the same task are independent and safe (auditable attempts)', async () => {
  seedWorkspace('hermes-ws-dup');
  const task = { id: 'synthetic-dup', workspace_id: 'hermes-ws-dup', request: 'report status', source_channel: 'api', actor_id: 'tester', budget_cents: 0, idempotency_key: 'dup-run-1' };
  const a = await runHermesWorkflow(task);
  const b = await runHermesWorkflow(task);
  assert.notEqual(a.runId, b.runId, 'each invocation is a distinct auditable run');
  assert.equal(a.status, 'completed');
  assert.equal(b.status, 'completed');
  // Candidates from both runs remain pending; nothing auto-promotes across re-runs.
  assert.ok([...store.getMemoryCandidates(a.runId), ...store.getMemoryCandidates(b.runId)].every((c) => c.status === 'pending'));
});
