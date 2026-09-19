import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRehearsalIntake, RECOVERY_SHA, RECOVERY_ARTIFACT, INTAKE_PATH, RETIRED_PATHS } from '../packages/zola-rollback/intake.js';

function fixture(overrides = {}) {
  const token = randomBytes(32).toString('base64url');
  const admissions = [];
  const options = { recoverySha: RECOVERY_SHA, artifactSha256: RECOVERY_ARTIFACT, token,
    principalId: 'rehearsal-owner', workspaceId: 'rehearsal-workspace', apiGeneration: 'api-one', workerGeneration: 'worker-one',
    resolvePrincipal: (principalId) => ({ principalId }), requirePermission: () => ({ allowed: true }),
    currentGenerations: () => ({ apiGeneration: 'api-one', workerGeneration: 'worker-one' }),
    admit: (input) => { admissions.push(input); return { taskId: 'task_synthetic' }; }, ...overrides };
  const handle = createRehearsalIntake(options);
  const body = { version: 1, workspaceId: options.workspaceId, principalId: options.principalId,
    capabilityId: 'seller.opportunities.search', apiGeneration: options.apiGeneration, workerGeneration: options.workerGeneration, requestId: randomUUID() };
  const request = { method: 'POST', rawPath: INTAKE_PATH, authorization: `Bearer ${token}`, contentType: 'application/json', bodyBytes: Buffer.from(JSON.stringify(body)) };
  return { options, handle, body, request, admissions };
}

test('authenticated fixed read admission binds principal workspace capability and generations', () => {
  const f = fixture();
  for (const capabilityId of ['seller.opportunities.search', 'buyer.profiles.search', 'buyer.matches.search', 'deal.records.search', 'deal.analysis.get', 'nexus.enrichment.status']) {
    const body = { ...f.body, capabilityId, ...(['buyer.matches.search', 'deal.analysis.get', 'nexus.enrichment.status'].includes(capabilityId) ? { dealId: 'DE-0001' } : {}) };
    assert.equal(f.handle({ ...f.request, bodyBytes: Buffer.from(JSON.stringify(body)) }).status, 202);
  }
  assert.equal(new Set(f.admissions.map((x) => x.idempotencyKey)).size, 6);
  for (const input of f.admissions) {
    assert.equal(input.actorId, f.body.principalId); assert.equal(input.workspaceId, f.body.workspaceId);
    assert.equal(input.executionIntent, 'read_only'); assert.equal(input.authority, 'authenticated_admin');
    assert.ok(Object.isFrozen(input));
  }
});

test('anonymous wrong credential malformed schema bindings and legacy routes never admit', () => {
  const f = fixture();
  const changes = [{ authorization: undefined }, { authorization: 'Bearer wrong' }, { authorization: 'é'.repeat(f.request.authorization.length) }, { method: 'GET' }, { contentType: 'text/plain' },
    { bodyBytes: Buffer.alloc(2049) }, { bodyBytes: Buffer.from('{') }, { bodyBytes: Buffer.from([0xff]) }];
  for (const rawPath of [...RETIRED_PATHS, `${INTAKE_PATH}/`, `${INTAKE_PATH}?x=1`, INTAKE_PATH.toUpperCase(),
    INTAKE_PATH.replace('/zola/', '//zola/'), INTAKE_PATH.replace('zola', '%7aola'), INTAKE_PATH.replace('zola', 'x/../zola'),
    INTAKE_PATH.replace('/zola', '\\zola'), `https://localhost${INTAKE_PATH}`, '/api/internal/capabilities/buyer-profiles']) changes.push({ rawPath });
  for (const patch of [{ workspaceId: 'other' }, { principalId: 'other' }, { capabilityId: 'buyer.write' }, { capabilityId: '__proto__' }, { capabilityId: ['seller.opportunities.search'] }, { capabilityId: {} }, { capabilityId: null }, { capabilityId: 1 },
    { apiGeneration: 'stale' }, { workerGeneration: 'stale' }, { requestId: 'bad' }, { url: 'https://paid.invalid' }, { text: 'write everything' },
    { permission: 'admin' }, { dealId: 'DE-0001' }, { capabilityId: 'deal.analysis.get' }]) changes.push({ bodyBytes: Buffer.from(JSON.stringify({ ...f.body, ...patch })) });
  changes.push({ bodyBytes: Buffer.from(JSON.stringify(f.body).replace('"version":1', '"version":0,"version":1')) });
  for (const change of changes) assert.equal(f.handle({ ...f.request, ...change }).status, 404);
  assert.equal(f.admissions.length, 0);
});

test('persisted permission and generation revocation are checked immediately before admission', () => {
  for (const mode of ['principal', 'permission', 'generation', 'second-check']) {
    let checks = 0;
    const f = fixture({
      resolvePrincipal: (principalId) => mode === 'principal' ? null : { principalId },
      requirePermission: () => ({ allowed: mode !== 'permission' }),
      currentGenerations: () => ({ apiGeneration: 'api-one', workerGeneration: mode === 'generation' || (mode === 'second-check' && ++checks > 1) ? 'stale' : 'worker-one' }),
    });
    assert.equal(f.handle(f.request).status, 404); assert.equal(f.admissions.length, 0);
  }
});

test('configuration pins and errors fail closed without credentials or arbitrary errors', () => {
  const f = fixture();
  for (const change of [{ recoverySha: '0'.repeat(40) }, { artifactSha256: '0'.repeat(64) }, { token: 'short' }]) {
    assert.throws(() => createRehearsalIntake({ ...f.options, ...change }), /INVALID_REHEARSAL/);
  }
  const bad = fixture({ admit: () => { throw new Error('private-error-do-not-emit'); } });
  assert.deepEqual(bad.handle(bad.request), { status: 503, error: 'admission outcome unknown' });
});
