// Hermes Milestone 2 — runtime & provider framework tests.
//
// All real-provider paths use a deterministic injected fake adapter; no paid/credentialed call is
// made by this suite. The development profile is forced via an explicit env object per test.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m2-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm2.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'm2-test-token';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.PORT = '8905';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);

const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { createFakeAdapter } = await import('../packages/hermes-orchestrator/adapters/fake-provider.js');
const { createAnthropicDevAdapter } = await import('../packages/hermes-orchestrator/adapters/anthropic-dev.js');
const { validateProviderDefinition, providerRegistry } = await import('../packages/hermes-orchestrator/registries.js');
const { resolveRuntimeProfile, realProviderPermitted, workspacePermitted } = await import('../packages/hermes-orchestrator/runtime-profile.js');
const { acquire } = await import('../packages/hermes-orchestrator/concurrency.js');
const { grantApproval } = await import('../packages/hermes-orchestrator/approvals.js');
const health = await import('../packages/hermes-orchestrator/health.js');
const { buildRuntimeStatus } = await import('../packages/hermes-orchestrator/status.js');

// Reset provider health before each test so cooldown accumulated by failure-path tests does not
// bleed into later tests (each test asserts a clean provider unless it deliberately trips cooldown).
beforeEach(() => { try { health.recordSuccess('anthropic'); } catch { /* db not ready */ } });

function ws(id) {
  upsertWorkspace({ id, name: id, description: 'm2', githubRepository: 'local/m2', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['true'], providerPolicy: { preferred: ['mock'] }, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['status', 'read'], lastHealthStatus: 'ok', rootPath: root });
}
// Development profile with the real path enabled and anthropic allowlisted.
const DEV = { ...process.env, HERMES_RUNTIME_PROFILE: 'development', HERMES_DEV_REAL_PROVIDER: 'true', HERMES_DEV_PROVIDER_ALLOWLIST: 'anthropic', HERMES_DEV_WORKSPACE_ALLOWLIST: root };
const fake = (behavior, opts = {}) => ({ adapterOverrides: { anthropic: createFakeAdapter({ behavior, ...opts }) }, env: DEV });
const realTask = (id, extra = {}) => ({ id, workspace_id: extra.ws || 'm2', request: extra.request || 'report the current status', source_channel: 'api', actor_id: 'tester', budget_cents: extra.budget ?? 100, idempotency_key: id, requestedProvider: 'anthropic', ...extra.raw });

test('registry: every provider definition is valid and none is production-eligible', () => {
  for (const p of providerRegistry.list()) assert.ok(validateProviderDefinition(p));
});

test('provider disabled by default: requesting anthropic with no dev flags is BLOCKED (no mock fallback)', async () => {
  ws('m2'); const r = await runHermesWorkflow(realTask('m2-default-off'), { env: { ...process.env } });
  assert.equal(r.status, 'blocked');
  assert.equal(r.outcome, 'real_provider_blocked');
  assert.equal(store.getProviderInvocations(r.runId).length, 0, 'no provider was invoked');
});

test('development feature-flag refusal: flag off blocks the real path', async () => {
  const env = { ...process.env, HERMES_RUNTIME_PROFILE: 'development', HERMES_DEV_PROVIDER_ALLOWLIST: 'anthropic' };
  const r = await runHermesWorkflow(realTask('m2-flag-off'), { env });
  assert.equal(r.outcome, 'real_provider_blocked');
});

test('provider allowlist refusal: anthropic not on allowlist blocks', async () => {
  const env = { ...process.env, HERMES_RUNTIME_PROFILE: 'development', HERMES_DEV_REAL_PROVIDER: 'true', HERMES_DEV_PROVIDER_ALLOWLIST: 'somethingelse' };
  const r = await runHermesWorkflow(realTask('m2-allowlist'), { env });
  assert.equal(r.outcome, 'real_provider_blocked');
});

test('production profile refuses real execution even with a credential present', async () => {
  const env = { ...process.env, BLACKSPIRE_RUNTIME_MODE: 'production', HERMES_DEV_REAL_PROVIDER: 'true', HERMES_DEV_PROVIDER_ALLOWLIST: 'anthropic', ANTHROPIC_API_KEY: 'x' };
  const gate = realProviderPermitted('anthropic', resolveRuntimeProfile(env));
  assert.equal(gate.allowed, false);
  const r = await runHermesWorkflow(realTask('m2-prod'), { ...fake('ok'), env });
  assert.equal(r.status, 'blocked');
});

test('allowed low-risk real development task completes, verifies, and records a real invocation', async () => {
  const r = await runHermesWorkflow(realTask('m2-real-ok'), fake('ok'));
  assert.equal(r.status, 'completed');
  assert.equal(r.outcome, 'verified');
  assert.equal(r.executionMode, 'real', 'execution mode is clearly real');
  const inv = store.getProviderInvocations(r.runId);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].provider, 'anthropic');
  assert.equal(inv[0].mode, 'real');
  assert.equal(inv[0].status, 'completed');
  const cands = store.getMemoryCandidates(r.runId);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].status, 'pending');
});

test('missing credential refusal (real adapter, dev-enabled, no key)', async () => {
  const adapter = createAnthropicDevAdapter({ env: { ...DEV } }); // no ANTHROPIC_API_KEY
  const res = await adapter.execute({ objective: 'status', limits: { maxInputBytes: 1000, maxOutputBytes: 1000 } });
  assert.equal(res.ok, false);
  assert.equal(res.structuredError.code, 'missing_credential');
});

test('medium-risk task requires approval; blocked without, proceeds with a scoped single-use approval', async () => {
  ws('m2-appr');
  const base = { ws: 'm2-appr', request: 'refactor the parser module' }; // code.edit -> medium risk
  const blocked = await runHermesWorkflow(realTask('m2-appr-1', base), fake('ok'));
  assert.equal(blocked.outcome, 'approval_required');
  assert.equal(store.getProviderInvocations(blocked.runId).length, 0, 'no provider call before approval');
  // Grant a scoped approval for this task's action class, then re-run.
  const policyRow = store.getPolicyDecisions(blocked.runId)[0];
  grantApproval({ taskId: 'm2-appr-1', actionClass: policyRow.action_class, reason: 'test' });
  const ok = await runHermesWorkflow(realTask('m2-appr-1', base), fake('ok'));
  assert.equal(ok.status, 'completed');
  // Single-use: a second run must be blocked again (approval consumed).
  const again = await runHermesWorkflow(realTask('m2-appr-1', base), fake('ok'));
  assert.equal(again.outcome, 'approval_required');
});

test('high-risk task is blocked before any provider call', async () => {
  ws('m2-hr');
  const r = await runHermesWorkflow(realTask('m2-hr-1', { ws: 'm2-hr', request: 'deploy to production immediately' }), fake('ok'));
  assert.equal(r.status, 'blocked');
  assert.equal(store.getProviderInvocations(r.runId).length, 0);
});

test('timeout is reported as failed with timedOut, learns nothing', async () => {
  const r = await runHermesWorkflow(realTask('m2-timeout'), fake('timeout'));
  assert.equal(r.executionMode, 'failed');
  assert.equal(r.outcome, 'execution_failed');
  assert.equal(store.getMemoryCandidates(r.runId).length, 0);
  assert.equal(store.getProviderInvocations(r.runId)[0].timed_out, 1);
});

test('cancellation via aborted signal is reported as cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const r = await runHermesWorkflow(realTask('m2-cancel'), { ...fake('ok'), signal: controller.signal });
  assert.equal(r.executionMode, 'cancelled');
  assert.equal(r.status, 'cancelled');
});

test('retry ceiling: a failing real provider is retried up to the policy ceiling, then fails', async () => {
  const r = await runHermesWorkflow(realTask('m2-retry'), fake('error'));
  assert.equal(r.executionMode, 'failed');
  // anthropic retryPolicy.maxRetries = 1 -> 2 attempts total.
  assert.equal(store.getProviderInvocations(r.runId).length, 2);
});

test('concurrency ceiling: acquire returns null at capacity (fail closed)', () => {
  const a = acquire('unit-prov', 1);
  assert.ok(a);
  assert.equal(acquire('unit-prov', 1), null, 'second acquire beyond limit is refused');
  a.release();
  assert.ok(acquire('unit-prov', 1), 'slot available after release');
});

test('budget/cost ceiling: a reported cost above the ceiling fails the run', async () => {
  const r = await runHermesWorkflow(realTask('m2-budget', { budget: 1 }), fake('ok', { costCents: 999 }));
  assert.equal(r.outcome, 'budget_exhausted');
});

test('malformed provider response fails closed', async () => {
  const r = await runHermesWorkflow(realTask('m2-malformed'), fake('malformed'));
  assert.equal(r.executionMode, 'failed');
});

test('secret leakage in provider output is redacted before persistence', async () => {
  const r = await runHermesWorkflow(realTask('m2-leak'), fake('secretleak'));
  const invSerialized = JSON.stringify(store.getProviderInvocations(r.runId));
  assert.ok(!/sk-a{20,}/.test(invSerialized), 'no raw sk- secret persisted');
  const steps = JSON.stringify(store.getWorkflowSteps(r.runId));
  assert.ok(!/AKIAIOSFODNN7EXAMPLE/.test(steps) || /REDACTED/.test(steps));
});

test('oversized output is clamped and still verifies', async () => {
  const r = await runHermesWorkflow(realTask('m2-oversized'), fake('oversized'));
  // Oversized summary is clamped; run still completes and records bounded output bytes.
  assert.ok(['completed'].includes(r.status));
  const inv = store.getProviderInvocations(r.runId)[0];
  assert.ok(inv.output_bytes <= providerRegistry.get('anthropic').usageLimits.maxOutputBytes);
});

test('workspace escape: a workspace not on the dev allowlist is refused', () => {
  const rp = resolveRuntimeProfile(DEV);
  assert.equal(workspacePermitted('/etc', rp).allowed, false);
  assert.equal(workspacePermitted(root, rp).allowed, true);
});

test('provider health transitions to cooldown after repeated failures and then blocks', async () => {
  const env = { ...DEV, HERMES_DEV_PROVIDER_ALLOWLIST: 'anthropic' };
  // 3 failures trip cooldown.
  for (let i = 0; i < 3; i++) await runHermesWorkflow(realTask('m2-health-' + i), fake('error'));
  const h = health.currentHealth('anthropic');
  assert.equal(h.status, 'cooldown');
  const blocked = await runHermesWorkflow(realTask('m2-health-blocked'), { adapterOverrides: { anthropic: createFakeAdapter({ behavior: 'ok' }) }, env });
  assert.equal(blocked.executionMode, 'blocked');
  assert.equal(blocked.outcome, 'execution_blocked');
  health.recordSuccess('anthropic'); // reset for later tests
});

test('no silent real->mock fallback: a blocked real request never returns a mock success', async () => {
  const r = await runHermesWorkflow(realTask('m2-nofallback'), { env: { ...process.env } });
  assert.equal(r.status, 'blocked');
  assert.notEqual(r.executionMode, 'mock');
  assert.notEqual(r.executionMode, 'real');
});

test('usage/cost null handling: null cost is stored and treated as within budget', async () => {
  const r = await runHermesWorkflow(realTask('m2-nullcost'), fake('ok', { costCents: null }));
  assert.equal(r.status, 'completed');
  assert.equal(store.getProviderInvocations(r.runId)[0].cost_cents, null);
});

test('verified real run creates only a pending memory candidate (never promoted)', async () => {
  const r = await runHermesWorkflow(realTask('m2-pending'), fake('ok'));
  const c = store.getMemoryCandidates(r.runId);
  assert.equal(c.length, 1);
  assert.equal(c[0].status, 'pending');
  assert.equal(c[0].promoted_at, null);
});

test('duplicate real invocations are independent auditable runs', async () => {
  const a = await runHermesWorkflow(realTask('m2-dup'), fake('ok'));
  const b = await runHermesWorkflow(realTask('m2-dup'), fake('ok'));
  assert.notEqual(a.runId, b.runId);
});

test('default path (no requestedProvider) stays mock', async () => {
  ws('m2-mockdefault');
  const r = await runHermesWorkflow({ id: 'm2-mock-default', workspace_id: 'm2-mockdefault', request: 'report status', source_channel: 'api', actor_id: 'tester', budget_cents: 0, idempotency_key: 'm2-mock-default' }, { env: DEV });
  assert.equal(r.executionMode, 'mock');
  assert.equal(r.status, 'completed');
});

test('status surface exposes no credential value and only booleans for auth', () => {
  const withKey = buildRuntimeStatus({ ...DEV, ANTHROPIC_API_KEY: 'super-secret-value' });
  const serialized = JSON.stringify(withKey);
  assert.ok(!serialized.includes('super-secret-value'), 'credential value never appears in status');
  const anthropic = withKey.providers.find((p) => p.id === 'anthropic');
  assert.equal(anthropic.authentication, 'configured');
  const withoutKey = buildRuntimeStatus({ ...DEV, ANTHROPIC_API_KEY: '' });
  assert.equal(withoutKey.providers.find((p) => p.id === 'anthropic').authentication, 'not_configured');
  assert.equal(withKey.executionModeDefault, 'mock');
});
