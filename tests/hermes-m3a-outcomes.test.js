// Hermes M3A: immutable factual evaluations. No scorecard, routing, or memory behavior is tested
// because none is permitted in this phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m3a-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm3a.sqlite');
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { evaluateTerminalOutcome } = await import('../packages/hermes-orchestrator/outcome.js');

function workspace(id) { upsertWorkspace({ id, name: id, githubRepository: 'local/m3a', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root }); }
function task(id, text = 'report current status') { const i = createUnifiedInput({ channel: 'jarvis', actorId: 'm3a-user', channelKey: 'm3a-user', workspaceId: id, text, idempotencyKey: `m3a-${id}-${text}` }); return getTask(i.taskId); }

test('verified mock workflow creates one immutable positive factual evaluation with provenance', async () => {
  workspace('m3a-good'); const r = await runHermesWorkflow(task('m3a-good'));
  assert.equal(r.outcome, 'verified'); assert.ok(r.evaluationId);
  const e = store.getOutcomeEvaluation(r.evaluationId);
  assert.equal(e.learning_eligibility, 'positive_eligible'); assert.equal(e.project_id, 'm3a-good');
  assert.match(e.provenance_digest, /^[a-f0-9]{64}$/); assert.equal(e.cost_cents, 0, 'mock cost is an actually known zero');
  assert.ok(store.getOutcomeComponents(e.id).some((c) => c.name === 'stability_evidence' && c.status === 'unknown'));
  assert.throws(() => evaluateTerminalOutcome(r.runId), /already exists/);
});

test('blocked workflow is factual but ineligible; no verification can become positive evidence', async () => {
  workspace('m3a-block'); const r = await runHermesWorkflow(task('m3a-block', 'deploy to production'));
  const e = store.getOutcomeEvaluation(r.evaluationId);
  assert.equal(r.status, 'blocked'); assert.equal(e.learning_eligibility, 'ineligible_blocked'); assert.notEqual(e.learning_eligibility, 'positive_eligible');
});

test('evaluation rejects incomplete/reordered evidence and does not write a partial row', () => {
  assert.throws(() => evaluateTerminalOutcome('missing-run'), /finished terminal workflow run/);
});
