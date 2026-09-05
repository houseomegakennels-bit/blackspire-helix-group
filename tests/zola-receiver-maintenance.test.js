import test from 'node:test';
import assert from 'node:assert/strict';
import { auditReceiver, provisionMissingReceiver } from '../scripts/zola-receiver-maintenance.mjs';

const secret = 'test-only-capability-credential-'.repeat(2);
const tokenKey = 'BLACKSPIRE_CAPABILITY_TOKEN';
const workspaceKey = 'BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID';
const branch = 'release/zola-production-live';
function mock(records, values) {
  return async (url, options) => {
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return Response.json(url.pathname.endsWith('/env') ? { envs: records } : { value: values[url.pathname.split('/').at(-1)] });
  };
}
function run(fetchImpl) { return auditReceiver({ vercelToken: 'test-vercel-credential', capabilityToken: secret, fetchImpl }); }
const base = [
  { id: 'token', key: tokenKey, target: ['production', 'preview'] },
  { id: 'workspace', key: workspaceKey, target: ['production', 'preview'] },
];
const values = { token: secret, workspace: 'blackspire-command' };

test('receiver audit handles authorization denial without printing API body or token', async () => {
  for (const status of [401, 403]) {
    const report = await run(async () => new Response(secret, { status }));
    assert.deepEqual(report, { status: 'ACCESS REQUIRED' });
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});
test('receiver audit distinguishes missing and mismatched settings', async () => {
  const missing = await run(mock([], {}));
  assert.equal(missing.scopes[0].keys[0].status, 'MISSING');
  const mismatch = await run(mock(base, { ...values, token: 'wrong' }));
  assert.equal(mismatch.scopes[0].keys[0].status, 'MISMATCHED');
});
test('release preview overrides generic preview independently without disclosing values', async () => {
  const report = await run(mock([...base, { id: 'override', key: tokenKey, target: ['preview'], gitBranch: branch }], { ...values, override: 'wrong' }));
  assert.equal(report.scopes[0].keys[0].status, 'READY');
  assert.equal(report.scopes[1].keys[0].status, 'READY');
  assert.equal(report.scopes[2].keys[0].status, 'MISMATCHED');
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.ok(!JSON.stringify(report).includes('wrong'));
  assert.equal((await run(mock(base, values))).status, 'READY');
});
test('unreadable sensitive settings and duplicate scope records cannot pass', async () => {
  const sensitive = await run(mock([{ ...base[0], type: 'sensitive' }, base[1]], values));
  assert.equal(sensitive.scopes[0].keys[0].status, 'ACCESS REQUIRED');
  const duplicate = await run(mock([...base, { ...base[0], id: 'duplicate' }], { ...values, duplicate: secret }));
  assert.equal(duplicate.scopes[0].keys[0].status, 'AMBIGUOUS');
});
test('transport failures, invalid JSON, and oversized responses remain sanitized', async () => {
  for (const fetchImpl of [async () => { throw new Error(secret); }, async () => new Response(secret), async () => new Response('x'.repeat(1024 * 1024 + 1))]) {
    const report = await run(fetchImpl);
    assert.notEqual(report.status, 'READY');
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});

function mutableFixture({ initial = [], failAt = 0, lostResponseAt = 0, malformedResponse = false } = {}) {
  const records = initial.map((row) => ({ ...row }));
  const writes = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      writes.push(body);
      if (writes.length === failAt) throw new Error(secret);
      const row = { ...body, id: `created-${records.length}` };
      records.push(row);
      if (writes.length === lostResponseAt) throw new Error(secret);
      if (malformedResponse) return Response.json({ failed: [] });
      return Response.json({ created: row, failed: [] });
    }
    assert.equal(options.method, 'GET');
    return Response.json(url.pathname.endsWith('/env')
      ? { envs: records.map(({ value: _value, ...row }) => row) }
      : records.find((row) => row.id === url.pathname.split('/').at(-1)));
  };
  return { records, writes, fetchImpl };
}
const provision = (fetchImpl) => provisionMissingReceiver({ vercelToken: 'test-vercel-credential', capabilityToken: secret, fetchImpl });

test('approved provisioning creates only absent production and release-preview settings', async () => {
  const fixture = mutableFixture();
  const result = await provision(fixture.fetchImpl);
  assert.equal(result.status, 'READY');
  assert.equal(result.created, 4);
  assert.deepEqual(fixture.writes.map(({ key, target, gitBranch }) => [key, target, gitBranch]), [
    [tokenKey, ['production'], undefined], [workspaceKey, ['production'], undefined],
    [tokenKey, ['preview'], branch], [workspaceKey, ['preview'], branch],
  ]);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal((await provision(fixture.fetchImpl)).created, 0);
  assert.equal(fixture.writes.length, 4);
});

test('provisioning refuses existing mismatches before any mutation', async () => {
  const fixture = mutableFixture({ initial: [{ ...base[0], value: 'different' }] });
  assert.equal((await provision(fixture.fetchImpl)).status, 'EXISTING CONFIGURATION CONFLICT');
  assert.equal(fixture.writes.length, 0);
});

test('uncertain provisioning stops; fresh reconciliation preserves completed desired settings', async () => {
  const fixture = mutableFixture({ failAt: 2 });
  const failed = await provision(fixture.fetchImpl);
  assert.equal(failed.status, 'REQUEST FAILED');
  assert.equal(fixture.writes.length, 2);
  assert.ok(!JSON.stringify(failed).includes(secret));
  const recovered = await provision(fixture.fetchImpl);
  assert.equal(recovered.status, 'READY');
  assert.equal(fixture.records.length, 4);
  assert.equal(fixture.writes.filter(({ key, target }) => key === tokenKey && target[0] === 'production').length, 1);
});

test('lost create response is reconciled without duplicating the completed write', async () => {
  const fixture = mutableFixture({ lostResponseAt: 1 });
  assert.equal((await provision(fixture.fetchImpl)).status, 'REQUEST FAILED');
  assert.equal(fixture.records.length, 1);
  assert.equal((await provision(fixture.fetchImpl)).status, 'READY');
  assert.equal(fixture.records.length, 4);
  assert.equal(fixture.writes.length, 4);
});

test('malformed create acknowledgement stops further writes and cannot claim readiness', async () => {
  const fixture = mutableFixture({ malformedResponse: true });
  const report = await provision(fixture.fetchImpl);
  assert.equal(report.status, 'CREATE NOT CONFIRMED');
  assert.equal(report.created, 0);
  assert.equal(fixture.writes.length, 1);
});


test('generic preview is informational when production and release overrides pair correctly', async () => {
  const scoped = [
    ...base.map((row) => ({ ...row, target: ['production'] })),
    ...base.map((row) => ({ ...row, id: `${row.id}_release`, target: ['preview'], gitBranch: branch })),
  ];
  const scopedValues = { ...values, token_release: secret, workspace_release: 'blackspire-command' };
  const missing = await run(mock(scoped, scopedValues));
  assert.equal(missing.status, 'READY');
  assert.equal(missing.scopes[1].keys[0].status, 'MISSING');
  const mismatch = await run(mock([
    ...scoped,
    ...base.map((row) => ({ ...row, id: `${row.id}_generic`, target: ['preview'] })),
  ], { ...scopedValues, token_generic: 'wrong', workspace_generic: 'other-workspace' }));
  assert.equal(mismatch.status, 'READY');
  assert.equal(mismatch.scopes[1].keys[0].status, 'MISMATCHED');
  assert.equal(mismatch.scopes[2].keys[0].status, 'READY');
});
