import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHealthTransitionStore } from '../packages/health-transitions/store.js';
import { HealthTransitionEngine } from '../packages/health-transitions/engine.js';
import { collectHealthObservations } from '../packages/health-transitions/sources.js';
import { readOperatorDiagnostics } from '../packages/health-transitions/diagnostics.js';
import { redactMetadata } from '../packages/health-transitions/model.js';

// Fault injection against the load-bearing decision boundaries. Each test drives real production
// code and asserts the specific outcome that disappears when its guard is removed, so deleting or
// weakening the guard fails the test. An earlier version of this file asserted only over a literal
// object of booleans it had just constructed; it stayed green with the entire package deleted and
// so was not evidence of anything. Keep every scenario below routed through imported code.

const commit = 'a'.repeat(40);
let tick = 0;
const observation = (overrides = {}) => ({
  component: 'api_liveness', environment: 'disposable-staging', workspaceId: 'workspace-a',
  state: 'healthy', timestamp: new Date(Date.UTC(2026, 7, 5, 1, 0, tick++)).toISOString(),
  reasonCode: 'check_passed', reason: 'Mutation fixture observation', correlationId: `mut-${tick}`,
  commit, buildFingerprint: 'build-1', dependency: null, source: 'operator_fixture', metadata: {}, ...overrides,
});
const setup = () => { const store = new MemoryHealthTransitionStore(); return { store, engine: new HealthTransitionEngine(store) }; };

test('mutant: dropping the stale-timestamp guard would accept an out-of-order observation', () => {
  const { store, engine } = setup();
  const first = observation({ state: 'degraded', reasonCode: 'check_failed' });
  engine.observe(first);
  const older = { ...first, state: 'healthy', reasonCode: 'check_passed', timestamp: new Date(Date.parse(first.timestamp) - 60_000).toISOString() };
  const result = engine.observe(older);
  assert.equal(result.disposition, 'stale_rejected');
  assert.equal(result.accepted, false);
  // The guard must not merely report rejection: the older value must not become latest.
  assert.equal(store.latest('disposable-staging', 'workspace-a', 'api_liveness').state, 'degraded');
  assert.equal(store.events('disposable-staging', 'workspace-a').length, 1);
});

test('mutant: dropping duplicate suppression would flood history with identical observations', () => {
  const { store, engine } = setup();
  const only = observation();
  engine.observe(only);
  for (let i = 0; i < 5; i += 1) assert.equal(engine.observe(only).disposition, 'duplicate_suppressed');
  assert.equal(store.events('disposable-staging', 'workspace-a').length, 1);
});

test('mutant: dropping the environment key would leak observations across environments', () => {
  const { store, engine } = setup();
  engine.observe(observation());
  engine.observe(observation({ environment: 'staging', state: 'unavailable', reasonCode: 'check_failed' }));
  assert.equal(store.events('disposable-staging', 'workspace-a').length, 1);
  assert.equal(store.events('staging', 'workspace-a').length, 1);
  assert.equal(store.latest('disposable-staging', 'workspace-a', 'api_liveness').state, 'healthy');
  assert.equal(store.latest('staging', 'workspace-a', 'api_liveness').state, 'unavailable');
  // A leak would surface as the other environment's failure in this summary.
  assert.equal(engine.summary('disposable-staging', 'workspace-a').state, 'healthy');
});

test('mutant: dropping the workspace key would leak observations across workspaces', () => {
  const { store, engine } = setup();
  engine.observe(observation());
  engine.observe(observation({ workspaceId: 'workspace-b', state: 'unavailable', reasonCode: 'check_failed' }));
  assert.equal(store.events('disposable-staging', 'workspace-a').length, 1);
  assert.equal(engine.summary('disposable-staging', 'workspace-a').state, 'healthy');
  assert.equal(engine.summary('disposable-staging', 'workspace-b').state, 'unavailable');
});

test('mutant: dropping the rollback boundary would understate a core dependency outage', () => {
  for (const component of ['api_liveness', 'api_readiness', 'database', 'queue']) {
    const { engine } = setup();
    const event = engine.observe(observation({ component, state: 'unavailable', reasonCode: 'dependency_unavailable', dependency: component === 'database' || component === 'queue' ? component : null })).event;
    assert.equal(event.rollbackRecommendation, 'rollback_recommended', `${component} must recommend rollback`);
    assert.equal(event.operatorActionRequired, true);
    assert.equal(event.automaticActionTaken, false, 'the engine must never act on its own');
  }
  // migration_mismatch and a non-healthy build outrank rollback and demand an operator.
  const { engine } = setup();
  assert.equal(engine.observe(observation({ component: 'migration', state: 'migration_mismatch', reasonCode: 'version_mismatch' })).event.rollbackRecommendation, 'operator_intervention_required');
});

test('mutant: dropping redaction would publish secret-shaped metadata and unbounded keys', () => {
  const { engine } = setup();
  const event = engine.observe(observation({ metadata: { mode: 'bearer abc123', attempt: '2', uncontrolled: 'customer payload' } })).event;
  assert.deepEqual(event.metadata, { mode: '[REDACTED]', attempt: '2' });
  assert.equal(redactMetadata({ mode: 'x'.repeat(65) }).mode, '[REDACTED]');
  assert.deepEqual(redactMetadata({ session: 'abc' }), {}, 'non-allowlisted keys must be dropped entirely');
  assert.throws(() => engine.observe(observation({ reason: 'authorization=abc' })), /bounded and redacted/);
  assert.throws(() => engine.observe(observation({ correlationId: 'ghp_deadbeef' })), /invalid/);
});

test('mutant: dropping the authorization check would expose diagnostics to any caller', () => {
  const { store, engine } = setup();
  engine.observe(observation());
  const request = { principal: {}, environment: 'disposable-staging', workspaceId: 'workspace-a', store, engine };
  // Every non-{allowed:true} shape must deny, including a thrown-away or malformed decision.
  for (const authorize of [() => ({ allowed: false }), () => ({}), () => null, () => undefined, () => 'yes']) {
    const denied = readOperatorDiagnostics({ ...request, authorize });
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.body, { error: 'diagnostics unavailable' }, 'the denial body must not vary or leak a reason');
  }
  assert.equal(readOperatorDiagnostics({ ...request, authorize: () => ({ allowed: true }) }).status, 200);
});

test('mutant: reordering the worker branch would report a dead worker as healthy', () => {
  // workerRuntimeStatus returns ok = !required || (...), so ok is true in a default deployment
  // even when the worker is missing, stopped, or draining. Testing ok before state therefore
  // reported an absent worker as healthy and made the draining branch unreachable.
  const context = observation();
  const workerState = (worker) => collectHealthObservations(context, { worker }).find((item) => item.component === 'worker');
  for (const state of ['missing', 'stopped', 'unhealthy']) {
    const observed = workerState({ required: false, ok: true, state });
    assert.notEqual(observed.state, 'healthy', `an absent worker (${state}) must never read as healthy`);
    assert.equal(observed.state, 'unknown');
    assert.equal(observed.reasonCode, 'observation_unknown');
    assert.equal(workerState({ required: true, ok: false, state }).state, 'unavailable');
  }
  const draining = workerState({ required: false, ok: true, state: 'draining' });
  assert.equal(draining.state, 'draining', 'a draining worker must be visible, not healthy');
  assert.equal(draining.reasonCode, 'drain_started');
  assert.equal(workerState({ required: false, ok: true, state: 'stale' }).state, 'stale');
  assert.equal(workerState({ required: false, ok: true, state: 'idle' }).state, 'healthy');
  assert.equal(workerState({ required: false, ok: true, state: 'working' }).state, 'healthy');
});

test('mutant: removing the enabled-capability branch would pin providers to a permanent alarm', () => {
  const context = observation();
  const by = (sources) => Object.fromEntries(collectHealthObservations(context, sources).map((item) => [item.component, item]));
  const enabled = by({ providersDisabled: false, telegramMode: 'live' });
  assert.equal(enabled.providers.state, 'healthy', 'enabling providers is not a failure');
  assert.equal(enabled.telegram.state, 'healthy');
  const failing = by({ providersDisabled: false, providersHealthy: false, telegramMode: 'live', telegramHealthy: false });
  assert.equal(failing.providers.state, 'dependency_failure', 'an observed failure must still be reported');
  assert.equal(failing.telegram.state, 'dependency_failure');
  const sandboxed = by({ providersDisabled: true, telegramMode: 'dry-run' });
  assert.equal(sandboxed.providers.state, 'disabled');
  assert.equal(sandboxed.telegram.state, 'disabled');
});

test('mutant: weakening cursor validation would accept a forged or truncated cursor', () => {
  const { store, engine } = setup();
  for (const component of ['api_liveness', 'database', 'queue']) engine.observe(observation({ component }));
  const request = { principal: {}, environment: 'disposable-staging', workspaceId: 'workspace-a', store, engine, authorize: () => ({ allowed: true }), limit: 2 };
  const first = readOperatorDiagnostics(request);
  assert.equal(first.status, 200);
  const cursor = first.body.nextCursor;
  assert.ok(cursor);
  const [payload, checksum] = cursor.split('.');
  for (const forged of [`${cursor}x`, payload, `${payload}.${'0'.repeat(checksum.length)}`, `${payload}.${checksum}.extra`, 'not-a-cursor', 'a'.repeat(513)]) {
    assert.equal(readOperatorDiagnostics({ ...request, cursor: forged }).status, 400, `cursor must be rejected: ${String(forged).slice(0, 24)}`);
  }
  assert.equal(readOperatorDiagnostics({ ...request, cursor }).status, 200);
});

test('mutant: relaxing the limit bound would allow an unbounded diagnostics read', () => {
  const { store, engine } = setup();
  engine.observe(observation());
  const request = { principal: {}, environment: 'disposable-staging', workspaceId: 'workspace-a', store, engine, authorize: () => ({ allowed: true }) };
  for (const limit of [0, -1, 101, 1000, 1.5, NaN, '25', null]) {
    assert.equal(readOperatorDiagnostics({ ...request, limit }).status, 400, `limit must be rejected: ${String(limit)}`);
  }
  assert.equal(readOperatorDiagnostics({ ...request, limit: 100 }).status, 200);
  assert.equal(readOperatorDiagnostics({ ...request, limit: 1 }).status, 200);
});

test('mutant: dropping snapshot validation would rehydrate an unusable store', () => {
  const { store, engine } = setup();
  engine.observe(observation());
  for (const bad of [{ version: 2, latest: [], events: [] }, { version: 1, latest: null, events: [] }, { version: 1, latest: [], events: null }]) {
    assert.throws(() => new MemoryHealthTransitionStore(bad), /invalid health transition snapshot/);
  }
  const restored = new MemoryHealthTransitionStore(store.snapshot());
  assert.equal(restored.events('disposable-staging', 'workspace-a').length, 1);
  // Stored rows must be frozen so a caller cannot mutate history in place.
  assert.throws(() => { restored.events('disposable-staging', 'workspace-a')[0].newState = 'tampered'; }, TypeError);
});
