import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCanary, runCanary } from '../scripts/zola-routing-canary.mjs';
const sha = 'a'.repeat(40), nonce = 'b'.repeat(32), token = 'synthetic-secret-never-print';
const inventory = { projectId: 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou', teamId: 'team_CaRyRaulJaFnCLSfTdyRYNIW', observations: ['deployments','domains','aliases'].map(name => ({ name, status: 'COMPLETE', value: { paginationComplete: true } })), deployments: [{ url: 'candidate.vercel.app', state: 'READY', sha }, { url: 'recovery.vercel.app', state: 'READY', sha: '2c0b600c268faa0571f08322e16d7f81f37789be' }], domains: [{ name: 'example.com' }], aliases: [{ alias: 'alias.vercel.app' }] };
const plan = prepareCanary({ inventory, sha, nonce });
function fixture(mode) {
  let rows = [], version = null, history = [], lostPropagation = false;
  const snapshots = new Map();
  function save() { if (version) { snapshots.set(version.id, structuredClone(rows)); history = history.filter(item => item.id !== version.id); history.push(structuredClone(version)); } }
  if (mode === 'existing-canary' || mode === 'existing-empty-stage') { rows = [{ ...structuredClone(plan.add.route), id: 'route-one' }]; version = { id: 'version-one', isLive: true }; save(); }
  if (mode === 'existing-empty-stage') { rows = []; version = { id: 'version-two', isStaging: true }; save(); }
  const calls = [], journal = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    if (url.origin !== 'https://api.vercel.com') {
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, undefined);
      assert.equal(url.pathname, plan.path);
      if (mode === 'probe-error') throw new Error(token);
      if (mode === 'baseline-history-drift') { version = { id: 'foreign-empty', isLive: true }; save(); }
      const active = history.some(item => item.isLive && snapshots.get(item.id)?.length);
      return new Response('', { status: active && mode !== 'miss' ? 418 : 404, headers: active && mode !== 'marker-missing' ? { 'x-zola-routing-canary': nonce } : {} });
    }
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.redirect, 'error'); assert.equal(url.searchParams.get('teamId'), inventory.teamId);
    const response = data => new Response(JSON.stringify(data));
    if (options.method === 'GET') {
      if (url.pathname.endsWith('/versions')) {
        if (mode === 'staged' || (mode === 'late-staging' && rows.length)) return response({ versions: [{ id: 'foreign', isStaging: true }] });
        if (mode === 'malformed-flags' && rows.length) return response({ versions: [{ ...version, isStaging: 'true' }] });
        if (mode === 'contradictory-flags' && rows.length) return response({ versions: [{ ...version, isStaging: true, isLive: true }] });
        if (mode === 'duplicate-history' && rows.length) return response({ versions: [version, version] });
        return response({ versions: history });
      }
      const explicit = url.searchParams.get('versionId');
      if (explicit && !snapshots.has(explicit)) return new Response('', { status: 404 });
      if (mode === 'baseline-nonempty' && rows.length === 0) return response({ routes: [{ id: 'foreign' }], version: null });
      if (mode === 'propagation' && lostPropagation) { lostPropagation = false; return response({ routes: [], version: null }); }
      const selected = explicit ? history.find(item => item.id === explicit) : version;
      const content = explicit ? snapshots.get(explicit) : rows;
      // Actual content/ACK omit isStaging/isLive. Only history attests state.
      return response({ routes: content, version: selected ? { id: selected.id } : null });
    }
    if (options.method === 'POST' && !url.pathname.endsWith('/versions')) {
      assert.deepEqual(JSON.parse(options.body), plan.add);
      if (mode === 'post-lost') throw new Error(token);
      rows = [{ ...structuredClone(plan.add.route), id: 'route-one' }]; if (mode === 'route-extra') rows[0].route.methods = ['POST']; version = { id: 'version-one', isStaging: true }; save(); lostPropagation = mode === 'propagation';
      if (mode === 'add-response-lost' || mode === 'discard-response-lost') throw new Error(token);
      return new Response(null, { status: 204 });
    }
    if (options.method === 'DELETE') {
      assert.deepEqual(JSON.parse(options.body), { routeIds: ['route-one'] }); rows = []; version = { id: 'version-two', isStaging: true }; save();
      if (mode === 'delete-response-lost') throw new Error(token);
      return new Response(null, { status: 204 });
    }
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body); assert.equal(body.id, version.id);
    if (body.action === 'discard') { snapshots.delete(version.id); history = history.filter(item => item.id !== version.id); rows = []; version = null; if (mode === 'discard-response-lost') throw new Error(token); }
    else {
      history = history.map(item => ({ ...item, isLive: false })); version = { id: version.id, isLive: true }; if (mode === 'drift') rows.push({ id: 'foreign' }); save();
      if (mode === 'promote-response-lost' && version.id === 'version-one' || mode === 'cleanup-promote-response-lost' && version.id === 'version-two') throw new Error(token);
    }
    return new Response(null, { status: 204 });
  };
  return { fetchImpl, pause: async () => {}, record: event => journal.push(event), journal, calls };
}
test('one exact random path, complete deployment/domain/alias union; rejects partial/foreign inventories', () => {
  assert.equal(plan.hosts.length, 4); assert.equal(plan.applicationDenialProven, false);
  assert.equal(new RegExp(plan.add.route.route.src).test('/api/nexus/trace'), false);
  for (const input of [{ ...inventory, projectId: 'other' }, { ...inventory, observations: [] }, { ...inventory, deployments: [] }, { ...inventory, aliases: [{ alias: 'example.com@attacker.test' }] }]) assert.throws(() => prepareCanary({ inventory: input, sha, nonce }));
});
test('actual management state machine stages, verifies, promotes, probes all host classes, deletes ONLY canary and verifies restore', async () => {
  const f = fixture(); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'CANARY_COVERAGE_PASS'); assert.equal(result.restored, true); assert.equal(result.probes.length, 12); assert.equal(result.applicationDenialProven, false);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.method), ['POST','POST','DELETE','POST']);
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(f.journal).includes(token), false);
  assert.equal(f.journal.filter(e => e.event === 'mutation_intent').length, 4);
});
test('404, missing nonce marker and inaccessible hosts cannot pass; successfully published failed probes still restore', async () => {
  for (const mode of ['miss','marker-missing','probe-error']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f }); assert.equal(result.status, 'INCOMPLETE');
    if (mode !== 'probe-error') assert.equal(result.restored, true);
    else assert.equal(f.calls.some(c => c.method === 'POST'), false);
  }
});
test('foreign staging or existing routing stops before mutation; concurrent drift is never overwritten', async () => {
  for (const mode of ['staged','baseline-nonempty','drift']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f }); assert.equal(result.status, 'INCOMPLETE');
    assert.equal(f.calls.some(c => ['PUT','DELETE'].includes(c.method)), false);
    if (mode !== 'drift') assert.equal(f.calls.some(c => c.method === 'POST'), false);
  }
});
test('uncertain POST is never retried; errors sanitized and authority plan cannot broaden', async () => {
  const f = fixture('post-lost'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1); assert.equal(JSON.stringify(result).includes(token), false);
  const widened = structuredClone(plan); widened.add.route.route.src = '.*';
  await assert.rejects(runCanary({ plan: widened, token, ...fixture() }), /PLAN_SCOPE_MISMATCH/);
});

test('lost add and promote responses reconcile staged/live metadata and never discard a live version', async () => {
  for (const mode of ['add-response-lost', 'promote-response-lost']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.restored, true);
    const mutations = f.calls.filter(c => c.method !== 'GET');
    assert.equal(mutations.filter(c => new URL(c.url).pathname.endsWith('/routes') && c.method === 'POST').length, 1);
    if (mode === 'promote-response-lost') { assert.ok(mutations.some(c => c.method === 'DELETE')); assert.ok(mutations.every(c => !c.body.includes('discard'))); }
    else assert.ok(mutations.some(c => c.body.includes('discard')));
  }
});
test('unrecognized route fields and late concurrent staging stop before promotion or destructive cleanup', async () => {
  for (const mode of ['route-extra', 'late-staging']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.restored, false);
    assert.equal(f.calls.filter(c => c.method !== 'GET').length, 1);
  }
});

test('explicit crash cleanup only removes exact prior canary and cannot introduce or promote a canary', async () => {
  const f = fixture('existing-canary'); const result = await runCanary({ plan, token, ...f, cleanupOnly: true });
  assert.equal(result.status, 'CANARY_RESTORED'); assert.equal(result.applicationDenialProven, false);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.method), ['DELETE','POST']);
  const absent = fixture(); const stopped = await runCanary({ plan, token, ...absent, cleanupOnly: true });
  assert.equal(stopped.status, 'INCOMPLETE'); assert.equal(absent.calls.filter(c => c.method !== 'GET').length, 0);
});

test('same-head normal rerun only recovers prior exact canary and stops without another experiment', async () => {
  const f = fixture('existing-canary'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'RECOVERED_PRIOR_CANARY'); assert.equal(result.restored, true);
  assert.equal(result.coveragePass, undefined); assert.equal(result.applicationDenialProven, false);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.method), ['DELETE','POST']);
  assert.ok(result.probes.every(row => row.phase === 'after'));
});


test('actual optional content flags, empty mutation ACK and bounded propagation reconcile through explicit version/history', async () => {
  const f = fixture('propagation'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'CANARY_COVERAGE_PASS');
  assert.ok(f.calls.some(call => new URL(call.url).searchParams.has('versionId')));
  assert.ok(f.journal.some(event => event.event === 'readonly_reconciliation_pending'));
});
test('lost delete and cleanup promotion ACKs reconcile without any repeated mutation', async () => {
  for (const mode of ['delete-response-lost', 'cleanup-promote-response-lost']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f });
    assert.equal(result.status, 'CANARY_COVERAGE_PASS'); assert.equal(result.restored, true);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
    const bodies = f.calls.filter(call => call.method !== 'GET').map(call => call.method + call.body);
    assert.equal(new Set(bodies).size, bodies.length);
  }
});
test('malformed, contradictory or duplicate history never authorizes promotion or cleanup', async () => {
  for (const mode of ['malformed-flags', 'contradictory-flags', 'duplicate-history']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.restored, false);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
  }
});
test('completed experiment cannot be repeated using empty live metadata and retained history', async () => {
  const f = fixture(); assert.equal((await runCanary({ plan, token, ...f })).status, 'CANARY_COVERAGE_PASS');
  const count = f.calls.filter(call => call.method !== 'GET').length;
  const again = await runCanary({ plan, token, ...f });
  assert.equal(again.code, 'EXPERIMENT_REPLAY_OR_EXISTING_HISTORY');
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, count);
});

test('lost discard ACK requires exact version absence plus complete current/history state', async () => {
  const f = fixture('discard-response-lost'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.restored, true);
  assert.equal(f.calls.filter(call => call.body?.includes('discard')).length, 1);
  assert.ok(f.calls.some(call => new URL(call.url).searchParams.get('versionId') === 'version-one'));
});
test('crash after delete resumes only verified empty-stage promotion and never deletes again', async () => {
  const f = fixture('existing-empty-stage'); const result = await runCanary({ plan, token, ...f, cleanupOnly: true });
  assert.equal(result.status, 'CANARY_RESTORED');
  assert.deepEqual(f.calls.filter(call => call.method !== 'GET').map(call => JSON.parse(call.body)), [{ id: 'version-two', action: 'promote' }]);
});
test('unknown add without discovered identity cannot claim restored from empty metadata', async () => {
  const f = fixture('post-lost'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.restored, false); assert.equal(result.cleanupCode, 'CLEANUP_IDENTITY_UNKNOWN');
});

test('foreign empty live history arriving during baseline probes prevents the first add', async () => {
  const f = fixture('baseline-history-drift'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.code, 'EXPERIMENT_REPLAY_OR_EXISTING_HISTORY');
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
});
